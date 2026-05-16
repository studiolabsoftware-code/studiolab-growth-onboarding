// Post-issue management of finalized + draft Stripe invoices. Admin-only.
//
// Actions:
//
//   get-snapshot   - Fetches the full Stripe invoice (+ line items) so the
//                    admin UI can rehydrate the create-invoice modal for
//                    Revise (issued invoices) or Edit Draft (drafts).
//
//   resend         - Calls Stripe POST /v1/invoices/:id/send to dispatch the
//                    hosted-invoice email again. Bumps last_resent_at and
//                    resend_count on the invoices row.
//
//   void           - Calls Stripe POST /v1/invoices/:id/void. Writes our
//                    status='voided' + voided_at. After voiding, the admin
//                    UI's Revise flow re-creates a fresh invoice from the
//                    snapshot.
//
//   finalize-draft - Promotes a draft to a real issued invoice. Calls
//                    /finalize and (when collection_method='send_invoice')
//                    /send. Writes issued_at/due_at/hosted_url/pdf_url/
//                    number/email_sent_at and flips status='open'.
//
//   delete-draft   - Hard-deletes a draft on Stripe (DELETE /invoices/:id)
//                    and removes our ledger row. Only valid on drafts.
//
//   mark-paid      - Records an out-of-band payment (cheque, EFT, cash).
//                    Calls Stripe POST /v1/invoices/:id/pay with
//                    paid_out_of_band=true so the hosted-invoice page
//                    closes, writes our manual-payment metadata, and fires
//                    the post-payment workflow via onInvoicePaid().
//
//   refund         - Issues a full or partial refund through Stripe and
//                    updates amount_refunded_cents + status accordingly.
//                    Refuses to run on manually-paid invoices (no Stripe
//                    charge to refund).
//
// We don't try to "edit" a finalized invoice in place — Stripe's
// finalize-then-immutable rule makes that impossible. Voiding and
// recreating (Revise) is the supported path; Edit Draft is the path for
// invoices that haven't been issued yet.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { getStripeKey, getStripeMode, stripeRequest } from '../_shared/stripe.ts';
import { onInvoicePaid } from '../_shared/post-payment.ts';

type Action =
  | 'resend'
  | 'void'
  | 'get-snapshot'
  | 'finalize-draft'
  | 'delete-draft'
  | 'mark-paid'
  | 'refund';

interface RequestBody {
  action: Action;
  invoice_id?: string;
  stripe_invoice_id?: string;

  // mark-paid
  payment_method?: 'cheque' | 'bank_transfer' | 'cash' | 'other';
  payment_date?: string;        // YYYY-MM-DD
  payment_reference?: string;

  // refund
  refund_full?: boolean;
  refund_amount_cents?: number;
  reason?: string;
}

const VALID_ACTIONS: Action[] = [
  'resend', 'void', 'get-snapshot', 'finalize-draft', 'delete-draft', 'mark-paid', 'refund',
];

const VALID_METHODS = ['cheque', 'bank_transfer', 'cash', 'other'] as const;

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST required.' }, 405);

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Admin sign-in required.' }, 401);

    const body = await req.json().catch(() => ({})) as Partial<RequestBody>;
    const action = body.action as Action;
    if (!VALID_ACTIONS.includes(action)) {
      return jsonResponse({ ok: false, error: `action must be one of: ${VALID_ACTIONS.join(', ')}.` }, 400);
    }
    const idInput = (body.invoice_id || '').trim();
    const stripeIdInput = (body.stripe_invoice_id || '').trim();
    if (!idInput && !stripeIdInput) {
      return jsonResponse({ ok: false, error: 'invoice_id or stripe_invoice_id is required.' }, 400);
    }

    const sb = adminClient();
    const ledgerCols = 'id, stripe_invoice_id, status, submission_id, external_contact_id, number, resend_count, total_cents, amount_paid_cents, amount_refunded_cents, currency, collection_method, marked_paid_manually';
    const query = idInput
      ? sb.from('invoices').select(ledgerCols).eq('id', idInput).maybeSingle()
      : sb.from('invoices').select(ledgerCols).eq('stripe_invoice_id', stripeIdInput).maybeSingle();
    const { data: row } = await query;
    if (!row) return jsonResponse({ ok: false, error: 'Invoice not found.' }, 404);
    if (!row.stripe_invoice_id) return jsonResponse({ ok: false, error: 'Invoice is missing a Stripe id.' }, 400);

    const mode = await getStripeMode();
    const secretKey = getStripeKey(mode);

    switch (action) {
      case 'get-snapshot':   return await doGetSnapshot(sb, row, secretKey);
      case 'resend':         return await doResend(sb, row, caller, secretKey);
      case 'void':           return await doVoid(sb, row, caller, secretKey);
      case 'finalize-draft': return await doFinalizeDraft(sb, row, caller, secretKey);
      case 'delete-draft':   return await doDeleteDraft(sb, row, caller, secretKey);
      case 'mark-paid':      return await doMarkPaid(sb, row, body, caller, secretKey);
      case 'refund':         return await doRefund(sb, row, body, caller, secretKey);
    }
  } catch (err) {
    console.error('manage-invoice error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

// ============================================================================
// get-snapshot
// ============================================================================
// deno-lint-ignore no-explicit-any
async function doGetSnapshot(_sb: any, row: any, secretKey: string) {
  const snap = await stripeRequest<{
    id: string;
    currency?: string;
    collection_method?: string;
    days_until_due?: number | null;
    description?: string | null;
    customer_email?: string | null;
    customer_name?: string | null;
    customer_address?: { country?: string | null } | null;
    lines?: { data: Array<{
      description?: string | null;
      quantity?: number | null;
      amount?: number | null;
      unit_amount_excluding_tax?: number | null;
      price?: { unit_amount?: number | null; currency?: string } | null;
    }> };
  }>('GET', `invoices/${encodeURIComponent(row.stripe_invoice_id)}?expand[]=lines.data`, null, secretKey);
  if (!snap.ok || !snap.body) {
    return jsonResponse({ ok: false, error: snap.error || 'Could not fetch Stripe invoice.' }, 502);
  }
  const inv = snap.body;
  const lines = (inv.lines?.data || []).map((l) => {
    const qty = l.quantity || 1;
    const unitCents = (typeof l.unit_amount_excluding_tax === 'number' ? l.unit_amount_excluding_tax
      : l.price?.unit_amount != null ? l.price.unit_amount
      : Math.round((l.amount || 0) / Math.max(qty, 1)));
    return { description: l.description || '', quantity: qty, unit_amount_cents: unitCents };
  });
  return jsonResponse({
    ok: true,
    snapshot: {
      invoice_id: row.id,
      stripe_invoice_id: row.stripe_invoice_id,
      status: row.status,
      number: row.number,
      submission_id: row.submission_id,
      external_contact_id: row.external_contact_id,
      description: inv.description || '',
      currency: (inv.currency || 'aud').toUpperCase(),
      collection_method: inv.collection_method || 'send_invoice',
      due_days: inv.days_until_due || 14,
      customer_email: inv.customer_email || '',
      customer_name: inv.customer_name || '',
      customer_country: inv.customer_address?.country || '',
      lines,
    },
  });
}

// ============================================================================
// resend
// ============================================================================
// deno-lint-ignore no-explicit-any
async function doResend(sb: any, row: any, caller: any, secretKey: string) {
  if (row.status !== 'open' && row.status !== 'past_due') {
    return jsonResponse({
      ok: false,
      error: `Cannot resend a ${row.status} invoice. Only open invoices can be resent.`,
    }, 400);
  }
  const sent = await stripeRequest('POST', `invoices/${encodeURIComponent(row.stripe_invoice_id)}/send`, {}, secretKey);
  if (!sent.ok) {
    return jsonResponse({ ok: false, error: sent.error || 'Stripe resend failed.' }, 502);
  }
  const nowIso = new Date().toISOString();
  const newCount = (row.resend_count || 0) + 1;
  const { error: upErr } = await sb.from('invoices').update({
    last_resent_at: nowIso,
    resend_count: newCount,
  }).eq('id', row.id);
  if (upErr) console.warn('invoices update after resend failed:', upErr);

  try {
    await sb.from('activity_log').insert({
      submission_id: row.submission_id,
      action: 'invoice_resent',
      actor: caller.email,
      details: { invoice_id: row.id, stripe_invoice_id: row.stripe_invoice_id, number: row.number, resend_count: newCount },
    });
  } catch (e) { console.warn('activity_log insert failed:', e); }

  return jsonResponse({ ok: true, action: 'resend', resent_at: nowIso, resend_count: newCount });
}

// ============================================================================
// void
// ============================================================================
// deno-lint-ignore no-explicit-any
async function doVoid(sb: any, row: any, caller: any, secretKey: string) {
  if (row.status === 'paid') {
    return jsonResponse({
      ok: false,
      error: 'Cannot void a paid invoice. Issue a refund instead.',
    }, 400);
  }
  if (row.status === 'voided') {
    return jsonResponse({ ok: true, action: 'void', skipped: true, reason: 'Already voided.' });
  }
  if (row.status === 'draft') {
    return jsonResponse({
      ok: false,
      error: 'Cannot void a draft invoice. Use delete-draft instead.',
    }, 400);
  }
  const voided = await stripeRequest('POST', `invoices/${encodeURIComponent(row.stripe_invoice_id)}/void`, {}, secretKey);
  if (!voided.ok) {
    return jsonResponse({ ok: false, error: voided.error || 'Stripe void failed.' }, 502);
  }
  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb.from('invoices').update({
    status: 'voided',
    voided_at: nowIso,
  }).eq('id', row.id);
  if (upErr) console.warn('invoices update after void failed:', upErr);

  try {
    await sb.from('activity_log').insert({
      submission_id: row.submission_id,
      action: 'invoice_voided',
      actor: caller.email,
      details: { invoice_id: row.id, stripe_invoice_id: row.stripe_invoice_id, number: row.number },
    });
  } catch (e) { console.warn('activity_log insert failed:', e); }

  return jsonResponse({ ok: true, action: 'void', voided_at: nowIso });
}

// ============================================================================
// finalize-draft
// ============================================================================
// deno-lint-ignore no-explicit-any
async function doFinalizeDraft(sb: any, row: any, caller: any, secretKey: string) {
  if (row.status !== 'draft') {
    return jsonResponse({
      ok: false,
      error: `Only drafts can be finalised (current status: ${row.status}).`,
    }, 400);
  }
  const collectionMethod = row.collection_method || 'send_invoice';

  type StripeInv = {
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

  const finalised = await stripeRequest<StripeInv>(
    'POST',
    `invoices/${encodeURIComponent(row.stripe_invoice_id)}/finalize`,
    { auto_advance: collectionMethod === 'send_invoice' },
    secretKey,
    `slg-finalize-${row.id}`,
  );
  if (!finalised.ok || !finalised.body) {
    return jsonResponse({ ok: false, error: finalised.error || 'Stripe finalize failed.' }, 502);
  }
  const inv = finalised.body;

  let emailSentAtIso: string | null = null;
  if (collectionMethod === 'send_invoice') {
    const sendRes = await stripeRequest('POST', `invoices/${encodeURIComponent(row.stripe_invoice_id)}/send`, {}, secretKey);
    if (sendRes.ok) {
      emailSentAtIso = new Date().toISOString();
    } else {
      console.warn('Stripe /send after finalize-draft returned non-ok:', sendRes.error);
    }
  }

  const issuedAtIso = inv.status_transitions?.finalized_at
    ? new Date(inv.status_transitions.finalized_at * 1000).toISOString()
    : new Date().toISOString();
  const dueAtIso = inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null;
  const newStatus = inv.status === 'paid' ? 'paid' : 'open';

  const { error: upErr } = await sb.from('invoices').update({
    status: newStatus,
    number: inv.number,
    subtotal_cents: inv.subtotal ?? 0,
    tax_cents: inv.tax ?? 0,
    total_cents: inv.total ?? 0,
    amount_paid_cents: inv.amount_paid ?? 0,
    amount_remaining_cents: inv.amount_remaining ?? 0,
    issued_at: issuedAtIso,
    due_at: dueAtIso,
    hosted_url: inv.hosted_invoice_url,
    pdf_url: inv.invoice_pdf,
    email_sent_at: emailSentAtIso,
  }).eq('id', row.id);
  if (upErr) console.warn('invoices update after finalize-draft failed:', upErr);

  try {
    await sb.from('activity_log').insert({
      submission_id: row.submission_id,
      action: 'invoice_finalized_from_draft',
      actor: caller.email,
      details: {
        invoice_id: row.id,
        stripe_invoice_id: row.stripe_invoice_id,
        number: inv.number,
        total_cents: inv.total,
        currency: row.currency,
      },
    });
  } catch (e) { console.warn('activity_log insert failed:', e); }

  // Bump external-contact totals now (skipped on draft creation — this is
  // the moment the invoice actually issues).
  if (row.external_contact_id) {
    try {
      const { data: contact } = await sb.from('external_contacts')
        .select('invoice_count, total_invoiced_cents')
        .eq('id', row.external_contact_id)
        .maybeSingle();
      await sb.from('external_contacts').update({
        invoice_count: (contact?.invoice_count || 0) + 1,
        total_invoiced_cents: (contact?.total_invoiced_cents || 0) + (inv.total || 0),
        last_invoiced_at: new Date().toISOString(),
      }).eq('id', row.external_contact_id);
    } catch (e) { console.warn('external_contacts totals update failed:', e); }
  }

  return jsonResponse({
    ok: true,
    action: 'finalize-draft',
    invoice: {
      id: row.id,
      stripe_invoice_id: inv.id,
      number: inv.number,
      status: newStatus,
      total_cents: inv.total,
      currency: row.currency,
      hosted_url: inv.hosted_invoice_url,
      pdf_url: inv.invoice_pdf,
      email_sent_at: emailSentAtIso,
    },
  });
}

// ============================================================================
// delete-draft
// ============================================================================
// deno-lint-ignore no-explicit-any
async function doDeleteDraft(sb: any, row: any, caller: any, secretKey: string) {
  if (row.status !== 'draft') {
    return jsonResponse({
      ok: false,
      error: `Only drafts can be deleted (current status: ${row.status}).`,
    }, 400);
  }
  // Stripe DELETE /v1/invoices/:id is only valid for drafts and removes the
  // invoice + its invoiceitems entirely.
  const del = await stripeRequest('DELETE', `invoices/${encodeURIComponent(row.stripe_invoice_id)}`, null, secretKey);
  if (!del.ok) {
    return jsonResponse({ ok: false, error: del.error || 'Stripe draft delete failed.' }, 502);
  }
  const { error: rowErr } = await sb.from('invoices').delete().eq('id', row.id);
  if (rowErr) console.warn('invoices delete after delete-draft failed:', rowErr);

  try {
    await sb.from('activity_log').insert({
      submission_id: row.submission_id,
      action: 'invoice_draft_deleted',
      actor: caller.email,
      details: { invoice_id: row.id, stripe_invoice_id: row.stripe_invoice_id, number: row.number },
    });
  } catch (e) { console.warn('activity_log insert failed:', e); }

  return jsonResponse({ ok: true, action: 'delete-draft' });
}

// ============================================================================
// mark-paid
// ============================================================================
// deno-lint-ignore no-explicit-any
async function doMarkPaid(sb: any, row: any, body: Partial<RequestBody>, caller: any, secretKey: string) {
  if (row.status !== 'open' && row.status !== 'past_due') {
    return jsonResponse({
      ok: false,
      error: `Only open invoices can be marked paid (current status: ${row.status}).`,
    }, 400);
  }
  const method = body.payment_method;
  if (!method || !(VALID_METHODS as readonly string[]).includes(method)) {
    return jsonResponse({ ok: false, error: `payment_method must be one of: ${VALID_METHODS.join(', ')}.` }, 400);
  }
  const paymentDate = (body.payment_date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    return jsonResponse({ ok: false, error: 'payment_date must be YYYY-MM-DD.' }, 400);
  }
  const paymentRef = (body.payment_reference || '').trim().slice(0, 200) || null;

  // Tell Stripe the invoice has been paid outside of Stripe. This closes the
  // hosted invoice page (no more "Pay now") and stops Stripe's collection
  // attempts. paid_out_of_band=true is the supported flag here.
  const payRes = await stripeRequest('POST', `invoices/${encodeURIComponent(row.stripe_invoice_id)}/pay`, {
    paid_out_of_band: true,
  }, secretKey, `slg-mark-paid-${row.id}`);
  if (!payRes.ok) {
    return jsonResponse({ ok: false, error: payRes.error || 'Stripe paid_out_of_band call failed.' }, 502);
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb.from('invoices').update({
    status: 'paid',
    paid_at: nowIso,
    amount_paid_cents: row.total_cents,
    amount_remaining_cents: 0,
    marked_paid_manually: true,
    manual_payment_method: method,
    manual_payment_date: paymentDate,
    manual_payment_reference: paymentRef,
  }).eq('id', row.id);
  if (upErr) {
    console.error('invoices update after mark-paid failed:', upErr);
    return jsonResponse({ ok: false, error: 'Ledger update failed: ' + upErr.message }, 500);
  }

  try {
    await sb.from('activity_log').insert({
      submission_id: row.submission_id,
      action: 'invoice_marked_paid_manually',
      actor: caller.email,
      details: {
        invoice_id: row.id,
        stripe_invoice_id: row.stripe_invoice_id,
        number: row.number,
        total_cents: row.total_cents,
        currency: row.currency,
        payment_method: method,
        payment_date: paymentDate,
        payment_reference: paymentRef,
      },
    });
  } catch (e) { console.warn('activity_log insert failed:', e); }

  // Fire the single post-payment dispatcher. The Stripe webhook will also
  // call onInvoicePaid via invoice.payment_succeeded when paid_out_of_band
  // lands — Phase 6.2 hooks must be idempotent. For 6.1 the dispatcher is
  // a logging stub, so the double-call is harmless.
  await onInvoicePaid(sb, {
    invoiceId: row.id,
    trigger: 'manual',
    stripeInvoiceId: row.stripe_invoice_id,
    actorEmail: caller.email,
    amountPaidCents: row.total_cents,
    currency: row.currency,
  });

  return jsonResponse({ ok: true, action: 'mark-paid', paid_at: nowIso });
}

// ============================================================================
// refund
// ============================================================================
// deno-lint-ignore no-explicit-any
async function doRefund(sb: any, row: any, body: Partial<RequestBody>, caller: any, secretKey: string) {
  if (row.status !== 'paid' && row.status !== 'partially_refunded') {
    return jsonResponse({
      ok: false,
      error: `Only paid (or partially refunded) invoices can be refunded (current status: ${row.status}).`,
    }, 400);
  }
  if (row.marked_paid_manually) {
    return jsonResponse({
      ok: false,
      error: 'This invoice was paid out-of-band — there is no Stripe charge to refund. Handle the refund through your bank / cheque cancellation and add an internal note.',
    }, 400);
  }
  const total = row.total_cents || 0;
  const alreadyRefunded = row.amount_refunded_cents || 0;
  const refundCap = total - alreadyRefunded;
  if (refundCap <= 0) {
    return jsonResponse({ ok: false, error: 'Invoice has already been fully refunded.' }, 400);
  }

  let amountCents: number;
  if (body.refund_full === true) {
    amountCents = refundCap;
  } else {
    const requested = body.refund_amount_cents;
    if (!Number.isInteger(requested) || (requested as number) <= 0) {
      return jsonResponse({ ok: false, error: 'refund_amount_cents must be a positive integer.' }, 400);
    }
    if ((requested as number) > refundCap) {
      return jsonResponse({
        ok: false,
        error: `Refund amount exceeds remaining refundable balance (${refundCap} cents).`,
      }, 400);
    }
    amountCents = requested as number;
  }
  const reason = (body.reason || '').trim().slice(0, 500) || null;

  // Need the Stripe charge id to issue the refund. invoice.charge (legacy)
  // and invoice.payment_intent are both available; we read the invoice with
  // expand=payment_intent and pull latest_charge from it.
  const invRead = await stripeRequest<{
    id: string;
    charge?: string | null;
    payment_intent?: { id: string; latest_charge?: string | null } | string | null;
  }>('GET', `invoices/${encodeURIComponent(row.stripe_invoice_id)}?expand[]=payment_intent`, null, secretKey);
  if (!invRead.ok || !invRead.body) {
    return jsonResponse({ ok: false, error: invRead.error || 'Could not read Stripe invoice.' }, 502);
  }
  let chargeId: string | null = invRead.body.charge || null;
  const pi = invRead.body.payment_intent;
  if (!chargeId && pi && typeof pi === 'object') {
    chargeId = pi.latest_charge || null;
  }
  if (!chargeId) {
    return jsonResponse({ ok: false, error: 'No Stripe charge found on this invoice — cannot issue refund automatically.' }, 400);
  }

  const refundRes = await stripeRequest<{ id: string; amount: number; status: string }>(
    'POST',
    'refunds',
    {
      charge: chargeId,
      amount: amountCents,
      ...(reason ? { metadata: { reason } } : {}),
    },
    secretKey,
    `slg-refund-${row.id}-${alreadyRefunded + amountCents}`,
  );
  if (!refundRes.ok || !refundRes.body) {
    return jsonResponse({ ok: false, error: refundRes.error || 'Stripe refund failed.' }, 502);
  }

  const newRefunded = alreadyRefunded + amountCents;
  const fully = newRefunded >= total;
  const newStatus = fully ? 'refunded' : 'partially_refunded';
  const nowIso = new Date().toISOString();

  const { error: upErr } = await sb.from('invoices').update({
    amount_refunded_cents: newRefunded,
    status: newStatus,
    refunded_at: fully ? nowIso : null,
  }).eq('id', row.id);
  if (upErr) {
    console.warn('invoices update after refund failed:', upErr);
  }

  try {
    await sb.from('activity_log').insert({
      submission_id: row.submission_id,
      action: fully ? 'invoice_refunded' : 'invoice_partially_refunded',
      actor: caller.email,
      details: {
        invoice_id: row.id,
        stripe_invoice_id: row.stripe_invoice_id,
        number: row.number,
        refund_amount_cents: amountCents,
        total_refunded_cents: newRefunded,
        total_cents: total,
        currency: row.currency,
        reason,
        stripe_refund_id: refundRes.body.id,
      },
    });
  } catch (e) { console.warn('activity_log insert failed:', e); }

  return jsonResponse({
    ok: true,
    action: 'refund',
    refunded_amount_cents: amountCents,
    total_refunded_cents: newRefunded,
    fully_refunded: fully,
    status: newStatus,
  });
}
