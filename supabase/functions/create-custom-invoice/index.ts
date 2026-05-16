// Admin-issued one-off invoice. Handles two recipient modes:
//
//   1. Studio recipient — submission_id, looks up the Stripe Customer from
//      the submission (creating one if needed for legacy rows).
//   2. External recipient — either an existing external_contacts row, or
//      a new one created inline from {email, name, country}. The Stripe
//      Customer is looked up by email (so we converge on the same record if
//      the recipient already exists in Stripe from a prior flow) and the
//      external_contacts row is upserted.
//
// HARD SEPARATION RULES (memory: project_billing_separation_rules):
//   * The invoice is created as an explicit draft first, then invoiceitems
//     are attached via the `invoice:` parameter. Combined with
//     `pending_invoice_items_behavior: 'exclude'`, this guarantees nothing
//     unrelated (e.g. a GHL SaaS subscription draft) rolls into the same
//     invoice.
//   * Every Stripe object created here carries
//     `metadata.source = 'studiolab-growth-custom'` so the webhook filter
//     attributes events correctly and refuses to touch GHL invoices.
//   * Forbidden API surface (subscriptions.*, customers.delete, etc.) is
//     never called from this function.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { getAuGstTaxRateId, getStripeKey, getStripeMode, stripeRequest } from '../_shared/stripe.ts';

const TAX_CODE_SERVICES = 'txcd_20030000'; // General services (kept for forward-compat with automatic_tax; harmless under manual rates)

type LineItem = {
  description: string;
  amount_cents: number;
  quantity?: number;
};

type RecipientStudio = { type: 'studio'; submission_id: string };
type RecipientExisting = { type: 'external'; external_contact_id: string };
type RecipientNew = {
  type: 'external';
  email: string;
  name?: string;
  country?: string;
  notes?: string;
};
type Recipient = RecipientStudio | RecipientExisting | RecipientNew;

interface RequestBody {
  recipient: Recipient;
  currency: 'AUD' | 'USD';
  line_items: LineItem[];
  collection_method?: 'send_invoice' | 'charge_automatically';
  due_in_days?: number;        // for send_invoice mode; default 14
  description?: string;        // internal note shown on the invoice
  memo?: string;               // recipient-facing memo on the invoice
  // When true, create the Stripe invoice as a draft (line items attached,
  // not finalized, not sent). The admin UI uses this to park an invoice for
  // edit-and-send-later. Drafts are surfaced in the admin invoice list and
  // finalised via manage-invoice action='finalize-draft'.
  save_as_draft?: boolean;
  // When true, paying this invoice auto-spawns a project (Phase 6.2a).
  // For external recipients we always force this true on the server side
  // (external invoices always spawn per the spawn rules). For studios this
  // is admin-controlled via the modal checkbox.
  spawn_project_on_paid?: boolean;
  // Phase 6.3b: catalog SKU links per picked line. The post-payment hook
  // materialises each linked SKU's deliverable_template as deliverables
  // on the spawned project. Free-text lines produce no entries.
  source_sku_links?: Array<{ kind: 'upgrade' | 'general'; id: string }>;
}

function isoCountryForStripe(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const c = stored.trim().toUpperCase();
  if (c === 'UK') return 'GB';
  if (/^[A-Z]{2}$/.test(c)) return c;
  return null;
}

// Server-side mirror of the admin modal's currency lock. AU → AUD with
// GST, everyone else → USD without GST. Returns null when country is
// unknown so a new external contact (admin didn't specify country) can
// still be invoiced without a forced currency.
function expectedCurrencyForCountry(country: string | null | undefined): 'AUD' | 'USD' | null {
  if (!country) return null;
  const c = country.trim().toUpperCase();
  if (c === 'AU' || c === 'AUS' || c === 'AUSTRALIA') return 'AUD';
  if (/^[A-Z]{2,3}$/.test(c) || c.length > 3) return 'USD';
  return null;
}

function badRequest(msg: string, code?: string) {
  return jsonResponse({ ok: false, error: msg, code }, 400);
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Admin sign-in required.' }, 401);

    const body = await req.json().catch(() => ({})) as Partial<RequestBody>;
    const recipient = body.recipient;
    const currency = body.currency;
    const lines = Array.isArray(body.line_items) ? body.line_items : [];
    const collectionMethod = body.collection_method || 'send_invoice';
    const dueInDays = body.due_in_days ?? 14;
    const description = (body.description || '').trim() || null;
    const memo = (body.memo || '').trim() || null;
    const saveAsDraft = body.save_as_draft === true;
    // External invoices always spawn (forced true). Studios respect the
    // admin checkbox; default false.
    const recipientIsExternal = !!recipient && recipient.type === 'external';
    const spawnProjectOnPaid = recipientIsExternal ? true : (body.spawn_project_on_paid === true);

    // Validate + normalise source_sku_links. Unknown shapes are dropped
    // silently — the materialiser is downstream, so a malformed entry
    // shouldn't fail the whole invoice. UUIDs are validated as RFC-4122-ish
    // (loose regex; create-custom-invoice itself doesn't query the SKU,
    // post-payment.ts does that with a defensive read).
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const sourceSkuLinks: Array<{ kind: 'upgrade' | 'general'; id: string }> = [];
    const seenSku = new Set<string>();
    if (Array.isArray(body.source_sku_links)) {
      for (const link of body.source_sku_links) {
        if (!link || typeof link !== 'object') continue;
        const kind = (link as { kind?: unknown }).kind;
        const id = (link as { id?: unknown }).id;
        if (kind !== 'upgrade' && kind !== 'general') continue;
        if (typeof id !== 'string' || !uuidRe.test(id)) continue;
        const key = `${kind}:${id}`;
        if (seenSku.has(key)) continue;
        seenSku.add(key);
        sourceSkuLinks.push({ kind, id });
      }
    }

    if (!recipient) return badRequest('Recipient is required.');
    if (currency !== 'AUD' && currency !== 'USD') return badRequest('Currency must be AUD or USD.');
    if (lines.length === 0) return badRequest('At least one line item is required.');
    for (const li of lines) {
      if (!li.description || typeof li.description !== 'string') return badRequest('Each line item needs a description.');
      if (!Number.isInteger(li.amount_cents) || li.amount_cents <= 0) return badRequest('Each line item needs a positive integer amount in cents.');
      if (li.quantity !== undefined && (!Number.isInteger(li.quantity) || li.quantity <= 0)) return badRequest('Quantity must be a positive integer.');
    }
    if (collectionMethod !== 'send_invoice' && collectionMethod !== 'charge_automatically') {
      return badRequest('collection_method must be send_invoice or charge_automatically.');
    }

    const sb = adminClient();
    const mode = await getStripeMode();
    const secretKey = getStripeKey(mode);

    // ---- Resolve recipient: Stripe Customer + submission/external_contact ids
    let stripeCustomerId: string | null = null;
    let submissionId: string | null = null;
    let externalContactId: string | null = null;
    let recipientEmail = '';
    let recipientCountryIso: string | null = null;

    if (recipient.type === 'studio') {
      const { data: sub } = await sb.from('submissions')
        .select('id, contact_email, first_name, last_name, studio_name, country, stripe_customer_id')
        .eq('id', recipient.submission_id)
        .maybeSingle();
      if (!sub) return badRequest('Studio not found.', 'submission_not_found');
      submissionId = sub.id;
      recipientEmail = (sub.contact_email || '').toLowerCase();
      recipientCountryIso = isoCountryForStripe(sub.country);
      // Server-side currency/country validation — see create-quote for
      // rationale. GST handling is tax-correctness load-bearing.
      const expectedCurrency = expectedCurrencyForCountry(sub.country);
      if (expectedCurrency && currency !== expectedCurrency) {
        return badRequest(
          expectedCurrency === 'AUD'
            ? 'Australian studios must be invoiced in AUD (10% GST applies).'
            : 'Overseas studios must be invoiced in USD (no GST).',
          'currency_country_mismatch',
        );
      }
      if (sub.stripe_customer_id) {
        stripeCustomerId = sub.stripe_customer_id;
      } else {
        // Create a Stripe Customer for a studio that has no existing one
        // (legacy rows from before the Stripe billing era). Tag with our
        // standard metadata so future webhook events classify cleanly.
        const fullName = [sub.first_name, sub.last_name].filter(Boolean).join(' ').trim()
          || sub.studio_name
          || sub.contact_email;
        const create = await stripeRequest<{ id: string }>('POST', 'customers', {
          email: sub.contact_email,
          name: fullName,
          metadata: {
            submission_id: sub.id,
            source: 'studiolab-growth-custom',
            studio_name: sub.studio_name || '',
          },
          ...(recipientCountryIso ? { 'address[country]': recipientCountryIso } : {}),
        }, secretKey, `studiolab-customer-${sub.id}`);
        if (!create.ok) return jsonResponse({ ok: false, error: create.error || 'Stripe customer create failed.' }, 502);
        stripeCustomerId = create.body.id;
        await sb.from('submissions').update({ stripe_customer_id: stripeCustomerId }).eq('id', sub.id);
      }
    } else {
      // External recipient — either existing row or new
      let contactRow: { id: string; email: string; name: string | null; country: string | null; stripe_customer_id: string | null } | null = null;
      if ('external_contact_id' in recipient && recipient.external_contact_id) {
        const { data } = await sb.from('external_contacts')
          .select('id, email, name, country, stripe_customer_id')
          .eq('id', recipient.external_contact_id)
          .maybeSingle();
        if (!data) return badRequest('External contact not found.', 'external_contact_not_found');
        contactRow = data;
      } else if ('email' in recipient && recipient.email) {
        const normEmail = recipient.email.trim().toLowerCase();
        // Look up by email first — re-invoicing the same person should
        // converge on the existing row.
        const { data: existing } = await sb.from('external_contacts')
          .select('id, email, name, country, stripe_customer_id')
          .ilike('email', normEmail)
          .maybeSingle();
        if (existing) {
          contactRow = existing;
        } else {
          const { data: inserted, error: insErr } = await sb.from('external_contacts')
            .insert({
              email: normEmail,
              name: recipient.name?.trim() || null,
              country: recipient.country?.trim().toUpperCase() || null,
              notes: recipient.notes?.trim() || null,
              created_by: caller.id,
            })
            .select('id, email, name, country, stripe_customer_id')
            .single();
          if (insErr || !inserted) {
            return jsonResponse({ ok: false, error: insErr?.message || 'Could not create external contact.' }, 500);
          }
          contactRow = inserted;
          // Activity log for the new contact (no submission_id — log against null)
          try {
            await sb.from('activity_log').insert({
              submission_id: null,
              action: 'external_contact_created',
              actor: caller.email,
              details: { external_contact_id: contactRow.id, email: contactRow.email },
            });
          } catch (e) { console.error('activity_log insert failed:', e); }
        }
      } else {
        return badRequest('External recipient requires either external_contact_id or email.');
      }

      externalContactId = contactRow.id;
      recipientEmail = contactRow.email.toLowerCase();
      recipientCountryIso = isoCountryForStripe(contactRow.country);
      const expectedExternalCurrency = expectedCurrencyForCountry(contactRow.country);
      if (expectedExternalCurrency && currency !== expectedExternalCurrency) {
        return badRequest(
          expectedExternalCurrency === 'AUD'
            ? 'Australian recipients must be invoiced in AUD (10% GST applies).'
            : 'Overseas recipients must be invoiced in USD (no GST).',
          'currency_country_mismatch',
        );
      }
      if (contactRow.stripe_customer_id) {
        stripeCustomerId = contactRow.stripe_customer_id;
      } else {
        // Find an existing Stripe Customer by email before creating one. If
        // the recipient already had a Stripe record (e.g. from a previous
        // invoice issued outside our system), we want to converge on it.
        const emailQ = `email:'${recipientEmail.replace(/'/g, "\\'")}'`;
        const search = await stripeRequest<{ data: Array<{ id: string; updated?: number; created?: number }> }>(
          'GET',
          `customers/search?query=${encodeURIComponent(emailQ)}`,
          null,
          secretKey,
        );
        if (search.ok && search.body.data && search.body.data.length) {
          const sorted = search.body.data.slice().sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
          stripeCustomerId = sorted[0].id;
          // Augment with our metadata (do not replace pre-existing keys)
          await stripeRequest('POST', `customers/${encodeURIComponent(stripeCustomerId)}`, {
            'metadata[external_contact_id]': contactRow.id,
            'metadata[source]': 'studiolab-growth-custom',
            ...(recipientCountryIso ? { 'address[country]': recipientCountryIso } : {}),
          }, secretKey);
        } else {
          const create = await stripeRequest<{ id: string }>('POST', 'customers', {
            email: recipientEmail,
            name: contactRow.name || recipientEmail,
            metadata: {
              external_contact_id: contactRow.id,
              source: 'studiolab-growth-custom',
            },
            ...(recipientCountryIso ? { 'address[country]': recipientCountryIso } : {}),
          }, secretKey, `studiolab-external-${contactRow.id}`);
          if (!create.ok) return jsonResponse({ ok: false, error: create.error || 'Stripe customer create failed.' }, 502);
          stripeCustomerId = create.body.id;
        }
        await sb.from('external_contacts')
          .update({ stripe_customer_id: stripeCustomerId })
          .eq('id', contactRow.id);
      }
    }

    if (!stripeCustomerId) {
      return jsonResponse({ ok: false, error: 'Could not resolve Stripe customer.' }, 500);
    }

    // ---- Resolve AU GST tax rate (manual). Manual rates work in every
    // Stripe environment without requiring Stripe Tax + business address
    // configured first — and they match the pattern create-checkout-session
    // and create-quote use, so AU GST behaves consistently across all three
    // flows. Falls back to baking 10% into unit_amount if the rate API call
    // fails so AU recipients still pay the GST-inclusive total either way.
    let auGstRateId: string | null = null;
    if (currency === 'AUD') {
      auGstRateId = await getAuGstTaxRateId(secretKey);
    }
    const useFallbackGst = currency === 'AUD' && !auGstRateId;

    // ---- Create the draft invoice FIRST so invoiceitems attach to ours.
    // pending_invoice_items_behavior=exclude is the load-bearing flag: it
    // ensures this invoice only contains items we explicitly add to it, so
    // a GHL SaaS draft can never roll in.
    const idempotencyBase = `slg-custom-${stripeCustomerId}-${Date.now()}`;
    const draft = await stripeRequest<{ id: string }>('POST', 'invoices', {
      customer: stripeCustomerId,
      currency: currency.toLowerCase(),
      collection_method: collectionMethod,
      ...(collectionMethod === 'send_invoice' ? { days_until_due: dueInDays } : {}),
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      // automatic_tax is intentionally OFF — GST is handled via the manual
      // tax rate attached to each line item below. See memory:
      // project_live_cutover_stripe_tax for the live-mode flip.
      automatic_tax: { enabled: false },
      description: memo || undefined,
      metadata: {
        source: 'studiolab-growth-custom',
        ...(submissionId ? { submission_id: submissionId } : {}),
        ...(externalContactId ? { external_contact_id: externalContactId } : {}),
        admin_email: caller.email,
      },
    }, secretKey, `${idempotencyBase}-invoice`);
    if (!draft.ok) return jsonResponse({ ok: false, error: draft.error || 'Stripe invoice create failed.' }, 502);
    const invoiceId = draft.body.id;

    // ---- Attach line items to OUR invoice id (not the customer's "next")
    for (let i = 0; i < lines.length; i++) {
      const li = lines[i];
      const qty = li.quantity ?? 1;
      const unitAmount = useFallbackGst ? Math.round(li.amount_cents * 1.10) : li.amount_cents;
      const itemBody: Record<string, unknown> = {
        customer: stripeCustomerId,
        invoice: invoiceId,
        currency: currency.toLowerCase(),
        description: li.description,
        quantity: qty,
        unit_amount: unitAmount,
        tax_code: TAX_CODE_SERVICES,
        tax_behavior: 'exclusive',
        metadata: {
          source: 'studiolab-growth-custom',
        },
      };
      if (currency === 'AUD' && auGstRateId) {
        itemBody.tax_rates = [auGstRateId];
      }
      const itemRes = await stripeRequest('POST', 'invoiceitems', itemBody, secretKey, `${idempotencyBase}-item-${i}`);
      if (!itemRes.ok) {
        // Best-effort void the draft so we don't leave an orphan
        await stripeRequest('POST', `invoices/${encodeURIComponent(invoiceId)}/void`, {}, secretKey);
        return jsonResponse({ ok: false, error: itemRes.error || 'Stripe invoice item create failed.' }, 502);
      }
    }

    // ---- Finalise (or, when save_as_draft, just fetch the draft totals).
    // Drafts skip /finalize and /send entirely. The line items are already
    // attached above, so Stripe holds the draft and we mirror it into the
    // ledger with status='draft'. The admin UI surfaces the draft and uses
    // manage-invoice action='finalize-draft' (Phase 6.1) to issue it later.
    type StripeInvoiceShape = {
      id: string;
      number: string | null;
      status: string;
      hosted_invoice_url: string | null;
      invoice_pdf: string | null;
      subtotal: number;
      tax: number | null;
      total: number;
      amount_paid: number;
      amount_remaining: number;
      due_date: number | null;
      status_transitions?: { finalized_at?: number | null };
    };

    let inv: StripeInvoiceShape;
    let emailSentAtIso: string | null = null;

    if (saveAsDraft) {
      // Fetch the draft so the ledger row carries the real Stripe-computed
      // subtotal/tax/total — keeps the admin UI honest if our local maths
      // ever drift from Stripe's. Drafts have status='draft', no number, no
      // hosted_invoice_url, no invoice_pdf.
      const draftRead = await stripeRequest<StripeInvoiceShape>(
        'GET',
        `invoices/${encodeURIComponent(invoiceId)}`,
        undefined,
        secretKey,
      );
      if (!draftRead.ok || !draftRead.body) {
        return jsonResponse({ ok: false, error: draftRead.error || 'Stripe draft read failed.' }, 502);
      }
      inv = draftRead.body;
    } else {
      const finalised = await stripeRequest<StripeInvoiceShape>(
        'POST',
        `invoices/${encodeURIComponent(invoiceId)}/finalize`,
        { auto_advance: collectionMethod === 'send_invoice' },
        secretKey,
        `${idempotencyBase}-finalize`,
      );
      if (!finalised.ok) {
        return jsonResponse({ ok: false, error: finalised.error || 'Stripe invoice finalize failed.' }, 502);
      }
      inv = finalised.body;

      // send_invoice: explicitly send the email now. (auto_advance also
      // schedules it, but calling /send guarantees the email is dispatched
      // immediately rather than on Stripe's internal advance schedule.)
      // Capture whether the send succeeded so we can stamp email_sent_at on
      // the ledger row below — gives the admin UI a clean "this went out at
      // <time>" signal instead of inferring from finalized_at.
      if (collectionMethod === 'send_invoice') {
        const sendRes = await stripeRequest('POST', `invoices/${encodeURIComponent(invoiceId)}/send`, {}, secretKey);
        if (sendRes.ok) {
          emailSentAtIso = new Date().toISOString();
        } else {
          console.warn('Stripe /send returned non-ok:', sendRes.error);
        }
      }
    }

    // ---- Write the ledger row immediately. The webhook will also write/
    // update on invoice.finalized, but inserting here makes the new invoice
    // appear in admin UI without waiting for webhook latency.
    const issuedAtIso = saveAsDraft
      ? null
      : (inv.status_transitions?.finalized_at
        ? new Date(inv.status_transitions.finalized_at * 1000).toISOString()
        : new Date().toISOString());
    const dueAtIso = inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null;
    const ledgerStatus = saveAsDraft
      ? 'draft'
      : (inv.status === 'open' ? 'open' : (inv.status === 'paid' ? 'paid' : 'draft'));

    const { data: ledgerRow, error: ledgerErr } = await sb.from('invoices')
      .upsert({
        submission_id: submissionId,
        external_contact_id: externalContactId,
        stripe_invoice_id: inv.id,
        stripe_customer_id: stripeCustomerId,
        number: inv.number,
        kind: 'custom_charge',
        source: 'studiolab-growth-custom',
        status: ledgerStatus,
        currency,
        subtotal_cents: inv.subtotal ?? 0,
        tax_cents: inv.tax ?? 0,
        total_cents: inv.total ?? 0,
        amount_paid_cents: inv.amount_paid ?? 0,
        amount_remaining_cents: inv.amount_remaining ?? 0,
        issued_at: issuedAtIso,
        due_at: dueAtIso,
        hosted_url: inv.hosted_invoice_url,
        pdf_url: inv.invoice_pdf,
        description,
        collection_method: collectionMethod,
        email_sent_at: emailSentAtIso,
        spawn_project_on_paid: spawnProjectOnPaid,
        source_sku_links: sourceSkuLinks,
        created_by: caller.id,
      }, { onConflict: 'stripe_invoice_id' })
      .select('id')
      .single();
    if (ledgerErr) {
      console.error('invoices ledger insert failed:', ledgerErr);
    }

    // ---- Activity + external_contact totals
    try {
      await sb.from('activity_log').insert({
        submission_id: submissionId,
        action: saveAsDraft ? 'invoice_drafted' : 'custom_invoice_sent',
        actor: caller.email,
        details: {
          invoice_id: inv.id,
          number: inv.number,
          total_cents: inv.total,
          currency,
          recipient_type: submissionId ? 'studio' : 'external',
          external_contact_id: externalContactId,
          ...(saveAsDraft ? { save_as_draft: true } : {}),
        },
      });
    } catch (e) { console.error('activity_log insert failed:', e); }

    if (externalContactId && !saveAsDraft) {
      // Best-effort totals bump. Refunds and the eventual paid event will
      // adjust further via the webhook. Skipped for drafts — they haven't
      // been issued yet, so they don't count against the contact's totals.
      // The finalize-draft action in manage-invoice bumps these instead.
      try {
        const { data: contact } = await sb.from('external_contacts')
          .select('invoice_count, total_invoiced_cents')
          .eq('id', externalContactId)
          .maybeSingle();
        await sb.from('external_contacts').update({
          invoice_count: (contact?.invoice_count || 0) + 1,
          total_invoiced_cents: (contact?.total_invoiced_cents || 0) + (inv.total || 0),
          last_invoiced_at: new Date().toISOString(),
        }).eq('id', externalContactId);
      } catch (e) { console.error('external_contacts totals update failed:', e); }
    }

    return jsonResponse({
      ok: true,
      invoice: {
        id: ledgerRow?.id || null,
        stripe_invoice_id: inv.id,
        number: inv.number,
        status: inv.status,
        total_cents: inv.total,
        currency,
        hosted_url: inv.hosted_invoice_url,
        pdf_url: inv.invoice_pdf,
      },
      stripe_mode: mode,
    });
  } catch (err) {
    console.error('create-custom-invoice error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
