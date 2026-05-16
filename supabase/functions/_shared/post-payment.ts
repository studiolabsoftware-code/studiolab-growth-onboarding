// Single-dispatch post-payment workflow.
//
// Both the Stripe webhook (`invoice.payment_succeeded`) and manage-invoice's
// `mark-paid` action funnel through `onInvoicePaid()` so the post-payment
// side effects can only ever live in one place.
//
// Phase 6.2a hook: auto-spawn a project when a paid invoice has no project
// yet. Spawn rules:
//   * External recipients: always spawn.
//   * Studio recipients: spawn only when invoices.spawn_project_on_paid is
//     true (admin opts in via the +Invoice modal; upgrade SKUs leave the
//     flag at the default false because they're state changes, not new
//     engagements).
//   * Setup-fee invoices (kind = 'setup_invoice') never spawn.
//
// Idempotent: if the invoice already carries a project_id, the spawn is
// skipped — Stripe's webhook and the manual mark-paid path can both fire
// onInvoicePaid for the same invoice without producing duplicate projects.

// deno-lint-ignore no-explicit-any
type Sb = any;

export type PostPaymentTrigger = 'webhook' | 'manual';

export interface PostPaymentContext {
  invoiceId: string;          // local invoices.id (uuid)
  trigger: PostPaymentTrigger;
  stripeInvoiceId?: string;
  actorEmail?: string;
  amountPaidCents?: number;
  currency?: string;
}

export async function onInvoicePaid(
  sb: Sb,
  ctx: PostPaymentContext,
): Promise<void> {
  try {
    console.log(
      `[post-payment] trigger=${ctx.trigger} invoice=${ctx.invoiceId} stripe=${ctx.stripeInvoiceId || '-'}`,
    );
    await maybeSpawnProject(sb, ctx);
    // Phase 6.2 next: send-payment-received email. Will be added inside this
    // dispatcher (gated on stripe_mode per project_email_gating_test_mode).
  } catch (err) {
    console.error('[post-payment] dispatcher error:', err);
  }
}

// Exported for the create-project edge function, which calls the same spawn
// logic with force=true for retroactive admin-initiated project creation
// from an existing paid invoice.
export async function spawnProjectFromInvoice(
  sb: Sb,
  invoiceId: string,
  opts: { force?: boolean; actorEmail?: string; name?: string; projectType?: string } = {},
): Promise<{ ok: true; project_id: string } | { ok: false; reason: string }> {
  const { data: inv } = await sb.from('invoices')
    .select('id, project_id, submission_id, external_contact_id, currency, description, spawn_project_on_paid, total_cents, number, kind, status, source_sku_links')
    .eq('id', invoiceId)
    .maybeSingle();
  if (!inv) return { ok: false, reason: 'Invoice not found.' };
  if (inv.project_id) return { ok: false, reason: 'Invoice already has a project.' };
  if (inv.kind === 'setup_invoice') return { ok: false, reason: 'Setup-fee invoices do not spawn projects.' };

  const isExternal = !!inv.external_contact_id;
  const isStudio = !!inv.submission_id;
  if (!isExternal && !isStudio) return { ok: false, reason: 'Invoice has no recipient.' };

  // Auto-spawn (force=false) respects the studio opt-in flag; manual spawn
  // from the admin "Create project" action ignores it.
  if (!opts.force) {
    if (isStudio && !inv.spawn_project_on_paid) {
      return { ok: false, reason: 'Studio invoice opted out of project spawn.' };
    }
  }

  let recipientName = 'Recipient';
  if (isStudio) {
    const { data: sub } = await sb.from('submissions')
      .select('studio_name, first_name, last_name, contact_email')
      .eq('id', inv.submission_id)
      .maybeSingle();
    recipientName = sub?.studio_name
      || [sub?.first_name, sub?.last_name].filter(Boolean).join(' ')
      || sub?.contact_email
      || 'Studio';
  } else {
    const { data: ec } = await sb.from('external_contacts')
      .select('name, email')
      .eq('id', inv.external_contact_id)
      .maybeSingle();
    recipientName = ec?.name || ec?.email || 'External recipient';
  }

  const fallbackName = `${recipientName} — ${(inv.description || `Invoice ${inv.number || ''}`).trim().slice(0, 80)}`.slice(0, 120);
  const projectName = (opts.name && opts.name.trim()) || fallbackName;

  let projectType = opts.projectType || 'service';
  if (!opts.projectType) {
    const desc = (inv.description || '').toLowerCase();
    if (desc.includes('website')) projectType = 'website_build';
    else if (desc.includes('consult')) projectType = 'consulting';
  }

  // Magic-link token. Concatenating two UUIDs gives a 64-char URL-safe
  // string with ~256 bits of entropy. Phase 6.2 verifyProjectToken in
  // _shared/projects.ts will use this for the client-facing project page.
  const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString();

  const { data: project, error: projErr } = await sb.from('projects')
    .insert({
      name: projectName,
      project_type: projectType,
      status: 'in_progress',
      submission_id: inv.submission_id,
      external_contact_id: inv.external_contact_id,
      currency: inv.currency,
      token,
      token_expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (projErr || !project) {
    console.warn('[post-payment] project insert failed:', projErr);
    return { ok: false, reason: projErr?.message || 'Project insert failed.' };
  }

  await sb.from('invoices').update({ project_id: project.id }).eq('id', inv.id);

  try {
    await sb.from('activity_log').insert({
      submission_id: inv.submission_id,
      project_id: project.id,
      action: 'project_created',
      actor: opts.actorEmail || 'system',
      details: {
        project_id: project.id,
        project_name: projectName,
        spawned_from_invoice_id: inv.id,
        invoice_number: inv.number,
        forced: !!opts.force,
      },
    });
  } catch (e) {
    console.warn('[post-payment] activity_log insert failed:', e);
  }

  // Phase 6.3b: materialise each linked SKU's deliverable_template onto the
  // freshly spawned project. Defensive: an unknown SKU id, an empty template,
  // or a malformed entry is skipped silently — the project is already live so
  // we never want to throw and double-spawn on retry.
  await materialiseDeliverableTemplates(sb, {
    projectId: project.id,
    submissionId: inv.submission_id,
    sourceSkuLinks: inv.source_sku_links,
    actorEmail: opts.actorEmail,
  });

  return { ok: true, project_id: project.id };
}

interface SkuLink { kind: 'upgrade' | 'general'; id: string }

interface TemplateRow {
  title: string;
  description?: string;
  visibility?: string;
  default_due_offset_days?: number | null;
}

async function materialiseDeliverableTemplates(
  sb: Sb,
  args: {
    projectId: string;
    submissionId: string | null;
    sourceSkuLinks: unknown;
    actorEmail?: string;
  },
): Promise<void> {
  const links = normaliseSkuLinks(args.sourceSkuLinks);
  if (links.length === 0) return;

  const upgradeIds = links.filter((l) => l.kind === 'upgrade').map((l) => l.id);
  const generalIds = links.filter((l) => l.kind === 'general').map((l) => l.id);

  const skuById = new Map<string, { kind: 'upgrade' | 'general'; name: string; template: TemplateRow[] }>();

  if (upgradeIds.length) {
    const { data: rows } = await sb.from('upgrade_products')
      .select('id, name, deliverable_template')
      .in('id', upgradeIds);
    for (const r of (rows || [])) {
      skuById.set(`upgrade:${r.id}`, {
        kind: 'upgrade',
        name: r.name || '',
        template: Array.isArray(r.deliverable_template) ? r.deliverable_template : [],
      });
    }
  }
  if (generalIds.length) {
    const { data: rows } = await sb.from('general_products')
      .select('id, name, deliverable_template')
      .in('id', generalIds);
    for (const r of (rows || [])) {
      skuById.set(`general:${r.id}`, {
        kind: 'general',
        name: r.name || '',
        template: Array.isArray(r.deliverable_template) ? r.deliverable_template : [],
      });
    }
  }

  // Preserve picked order for stable order_index assignment across SKUs.
  // 100, 110, 120 … matches the manual-create default ordering used in
  // manage-deliverable so they slot in cleanly.
  let order = 100;
  const today = new Date();

  for (const link of links) {
    const sku = skuById.get(`${link.kind}:${link.id}`);
    if (!sku || sku.template.length === 0) continue;

    for (const tpl of sku.template) {
      if (!tpl || typeof tpl !== 'object') continue;
      const title = (typeof tpl.title === 'string' ? tpl.title : '').trim().slice(0, 200);
      if (!title) continue;
      const description = (typeof tpl.description === 'string' ? tpl.description : '').slice(0, 4000);
      const visibility = tpl.visibility === 'internal' ? 'internal' : 'client';

      let dueDate: string | null = null;
      const offset = tpl.default_due_offset_days;
      if (typeof offset === 'number' && Number.isFinite(offset) && offset >= 0) {
        const due = new Date(today.getTime());
        due.setUTCDate(due.getUTCDate() + Math.floor(offset));
        dueDate = due.toISOString().slice(0, 10);
      }

      const { data: deliv, error: delivErr } = await sb.from('deliverables')
        .insert({
          project_id: args.projectId,
          title,
          description,
          visibility,
          due_date: dueDate,
          source_sku: `${link.kind}:${link.id}`,
          order_index: order,
        })
        .select('id')
        .single();
      order += 10;
      if (delivErr) {
        console.warn('[post-payment] template deliverable insert failed:', delivErr);
        continue;
      }

      try {
        await sb.from('activity_log').insert({
          submission_id: args.submissionId,
          project_id: args.projectId,
          action: 'deliverable_template_materialised',
          actor: args.actorEmail || 'system',
          details: {
            project_id: args.projectId,
            deliverable_id: deliv.id,
            source_sku: `${link.kind}:${link.id}`,
            sku_name: sku.name,
            title,
          },
        });
      } catch (e) {
        console.warn('[post-payment] template activity_log insert failed:', e);
      }
    }
  }
}

function normaliseSkuLinks(raw: unknown): SkuLink[] {
  if (!Array.isArray(raw)) return [];
  const out: SkuLink[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const kind = (entry as { kind?: unknown }).kind;
    const id = (entry as { id?: unknown }).id;
    if (kind !== 'upgrade' && kind !== 'general') continue;
    if (typeof id !== 'string' || !id) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, id });
  }
  return out;
}

async function maybeSpawnProject(sb: Sb, ctx: PostPaymentContext): Promise<void> {
  const result = await spawnProjectFromInvoice(sb, ctx.invoiceId, {
    force: false,
    actorEmail: ctx.actorEmail,
  });
  if (!result.ok) {
    console.log(`[post-payment] spawn skipped: ${result.reason}`);
  } else {
    console.log(`[post-payment] spawned project ${result.project_id}`);
  }
}

// Phase 6.5 — quote.accepted → spawn project (status='briefing') for
// external recipients only. Studios opt in per their invoice flag at the
// downstream invoice.paid event instead. Idempotent: if the quote already
// has project_id set, returns ok with the existing id.
export async function spawnProjectFromQuote(
  sb: Sb,
  quoteId: string,
): Promise<{ ok: true; project_id: string; was_existing: boolean } | { ok: false; reason: string }> {
  const { data: quote } = await sb.from('quotes')
    .select('id, project_id, submission_id, external_contact_id, currency, description, number, status, total_cents')
    .eq('id', quoteId)
    .maybeSingle();
  if (!quote) return { ok: false, reason: 'Quote not found.' };
  if (quote.project_id) return { ok: true, project_id: quote.project_id, was_existing: true };
  if (!quote.external_contact_id) {
    return { ok: false, reason: 'Quote-spawn restricted to external recipients (studios spawn via invoice opt-in).' };
  }

  const { data: ec } = await sb.from('external_contacts')
    .select('name, email')
    .eq('id', quote.external_contact_id)
    .maybeSingle();
  const recipientName = ec?.name || ec?.email || 'External recipient';
  const fallbackName = `${recipientName} — ${(quote.description || `Quote ${quote.number || ''}`).trim().slice(0, 80)}`.slice(0, 120);

  const desc = (quote.description || '').toLowerCase();
  let projectType = 'service';
  if (desc.includes('website')) projectType = 'website_build';
  else if (desc.includes('consult')) projectType = 'consulting';

  const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString();

  const { data: project, error: projErr } = await sb.from('projects')
    .insert({
      name: fallbackName,
      project_type: projectType,
      status: 'briefing',
      external_contact_id: quote.external_contact_id,
      currency: quote.currency,
      token,
      token_expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (projErr || !project) {
    console.warn('[post-payment] quote-spawn project insert failed:', projErr);
    return { ok: false, reason: projErr?.message || 'Project insert failed.' };
  }

  await sb.from('quotes').update({ project_id: project.id }).eq('id', quote.id);

  try {
    await sb.from('activity_log').insert({
      project_id: project.id,
      action: 'project_created',
      actor: 'system',
      details: {
        project_id: project.id,
        project_name: fallbackName,
        spawned_from_quote_id: quote.id,
        quote_number: quote.number,
        trigger: 'quote_accepted',
      },
    });
  } catch (_) {}

  return { ok: true, project_id: project.id, was_existing: false };
}
