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
    .select('id, project_id, submission_id, external_contact_id, currency, description, spawn_project_on_paid, total_cents, number, kind, status')
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

  return { ok: true, project_id: project.id };
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
