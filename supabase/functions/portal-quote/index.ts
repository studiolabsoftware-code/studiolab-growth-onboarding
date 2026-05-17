// Client-facing quote portal. Mirrors portal-project: single endpoint
// dispatching by `action`, every call gated on the quote token written to
// quotes.token by create-quote. The recipient never sees admin internals.
//
// Actions:
//   load     - { quote_id, token } -> quote summary + line items + PDF flag
//   accept   - { quote_id, token } -> calls Stripe /accept, marks ledger
//   decline  - { quote_id, token, reason? } -> Stripe /cancel with
//              metadata.cancel_reason='client_declined', marks ledger
//
// Stripe webhook quote.accepted / quote.canceled fire after our calls;
// the existing handleQuoteUpdate guards downgrade + retries the
// conditional update so the double-write is harmless.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verifyQuoteToken } from '../_shared/quotes.ts';
import { getStripeKey, getStripeMode, stripeRequest } from '../_shared/stripe.ts';

interface RequestBody {
  action: 'load' | 'accept' | 'decline';
  quote_id: string;
  token: string;
  reason?: string;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only.' }, 405);

  try {
    const body = await req.json() as Partial<RequestBody>;
    const action = body.action;
    const quoteId = (body.quote_id || '').trim();
    const token = (body.token || '').trim();
    if (!action || !quoteId || !token) {
      return jsonResponse({ ok: false, error: 'Missing required fields.' }, 400);
    }

    const sb = adminClient();
    const auth = await verifyQuoteToken(sb, quoteId, token);
    if (!auth.ok) {
      return jsonResponse({ ok: false, error: 'Invalid or expired link.' }, 401);
    }

    switch (action) {
      case 'load':    return await actLoad(sb, quoteId, auth);
      case 'accept':  return await actAccept(sb, quoteId, auth);
      case 'decline': return await actDecline(sb, quoteId, auth, body.reason || null);
      default:        return jsonResponse({ ok: false, error: 'Unknown action.' }, 400);
    }
  } catch (err) {
    console.error('portal-quote error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function actLoad(sb: any, quoteId: string, auth: { submissionId?: string | null; externalContactId?: string | null; status?: string | null; terminalStatus?: boolean }) {
  // Pull the row + the studio/external context for the brand header.
  // resulting_invoice is the back-linked invoice row (populated by the
  // webhook on invoice.finalized); surfacing it on load means the page
  // shows "Your invoice SLG-NNNN is ready — Pay now" on every visit,
  // not just immediately after acceptance.
  const { data: quote } = await sb.from('quotes')
    .select(`
      id, number, status, currency, acceptance_mode,
      subtotal_cents, tax_cents, total_cents, expires_at,
      sent_at, accepted_at, declined_at, cover_note, resulting_invoice_id,
      stripe_quote_id, submission_id, external_contact_id,
      submission:submissions(studio_name, contact_email, first_name, last_name),
      external_contact:external_contacts(name, email),
      resulting_invoice:invoices!quotes_resulting_invoice_id_fkey(id, number, status, hosted_url, total_cents, currency)
    `)
    .eq('id', quoteId)
    .maybeSingle();
  if (!quote) return jsonResponse({ ok: false, error: 'Quote not found.' }, 404);

  // Pull Stripe line items so the recipient sees the breakdown without the
  // PDF round-trip. Cached in Stripe; one GET per page load is fine for a
  // human-driven endpoint.
  let lineItems: Array<{ description: string; quantity: number; amount_cents: number }> = [];
  if (quote.stripe_quote_id) {
    const mode = await getStripeMode();
    const secretKey = getStripeKey(mode);
    const res = await stripeRequest<{ data: Array<{ description: string | null; quantity: number; amount_total: number | null }> }>(
      'GET',
      `quotes/${encodeURIComponent(quote.stripe_quote_id)}/line_items?limit=50`,
      null,
      secretKey,
    );
    if (res.ok && res.body?.data) {
      lineItems = res.body.data.map((li) => ({
        description: li.description || '',
        quantity: li.quantity || 1,
        amount_cents: li.amount_total ?? 0,
      }));
    }
  }

  // Recipient label for the page header.
  const recipientLabel = quote.submission_id
    ? (quote.submission?.studio_name
      || [quote.submission?.first_name, quote.submission?.last_name].filter(Boolean).join(' ')
      || quote.submission?.contact_email
      || 'You')
    : (quote.external_contact?.name || quote.external_contact?.email || 'You');

  return jsonResponse({
    ok: true,
    quote: {
      id: quote.id,
      number: quote.number,
      status: quote.status,
      currency: quote.currency,
      acceptance_mode: quote.acceptance_mode,
      subtotal_cents: quote.subtotal_cents,
      tax_cents: quote.tax_cents,
      total_cents: quote.total_cents,
      expires_at: quote.expires_at,
      sent_at: quote.sent_at,
      accepted_at: quote.accepted_at,
      declined_at: quote.declined_at,
      cover_note: quote.cover_note,
      resulting_invoice_id: quote.resulting_invoice_id,
      // Surface the back-linked invoice so the page can show "Pay now"
      // with a real Stripe-hosted URL. Null until the webhook has
      // processed invoice.finalized for the quote-derived invoice.
      resulting_invoice: quote.resulting_invoice ? {
        id: quote.resulting_invoice.id,
        number: quote.resulting_invoice.number,
        status: quote.resulting_invoice.status,
        hosted_url: quote.resulting_invoice.hosted_url,
        total_cents: quote.resulting_invoice.total_cents,
        currency: quote.resulting_invoice.currency,
      } : null,
      recipient_label: recipientLabel,
      line_items: lineItems,
      // Page uses this to show the read-only "this quote is closed" state
      // when the quote moved past the open window.
      terminal_status: auth.terminalStatus === true,
    },
  });
}

// deno-lint-ignore no-explicit-any
async function actAccept(sb: any, quoteId: string, auth: { status?: string | null; terminalStatus?: boolean }) {
  if (auth.terminalStatus) {
    return jsonResponse({ ok: false, error: `This quote is ${auth.status} and can no longer be accepted.` }, 409);
  }
  const { data: q } = await sb.from('quotes')
    .select('id, stripe_quote_id, submission_id, external_contact_id, currency, total_cents, number')
    .eq('id', quoteId)
    .maybeSingle();
  if (!q?.stripe_quote_id) return jsonResponse({ ok: false, error: 'Quote not finalised at Stripe.' }, 409);

  const mode = await getStripeMode();
  const secretKey = getStripeKey(mode);

  // Stripe /accept moves the quote to 'accepted' and creates the invoice
  // in DRAFT status. Stripe does NOT auto-finalize or send the invoice
  // email — that's our job. Two-step follow-up:
  //   1. POST /v1/invoices/{invoice_id}/finalize  → marks the invoice
  //      open, assigns a number, generates the hosted page + PDF, and
  //      fires invoice.finalized which our webhook uses to write the
  //      invoice row + back-link resulting_invoice_id on the quote.
  //   2. POST /v1/invoices/{invoice_id}/send → triggers the Stripe-sent
  //      "Pay this invoice" email to the recipient (the invoice /send
  //      endpoint still exists; only the quotes /send was removed).
  const accept = await stripeRequest<{ id: string; status: string; invoice: string | null }>(
    'POST',
    `quotes/${encodeURIComponent(q.stripe_quote_id)}/accept`,
    null,
    secretKey,
    `slg-quote-accept-${q.id}`,
  );
  if (!accept.ok) {
    console.error('Stripe quote accept failed:', accept.error);
    return jsonResponse({
      ok: false,
      error: 'We could not record your acceptance. Please try again in a moment, or reply to the quote email if it keeps failing.',
    }, 502);
  }

  // Optimistic local update — webhook will arrive shortly and the
  // conditional update guard handles the double-write.
  const nowIso = new Date().toISOString();
  await sb.from('quotes')
    .update({ status: 'accepted', accepted_at: nowIso })
    .eq('id', q.id)
    .in('status', ['sent', 'viewed']);

  try {
    await sb.from('activity_log').insert({
      submission_id: q.submission_id,
      action: 'quote_accepted',
      actor: 'client',
      details: {
        quote_id: q.id,
        stripe_quote_id: q.stripe_quote_id,
        number: q.number,
        external_contact_id: q.external_contact_id,
      },
    });
  } catch (e) { console.error('activity_log insert failed:', e); }

  // Finalize + send the resulting invoice. Both are best-effort: if
  // either fails we still report acceptance as successful (the quote IS
  // accepted at Stripe and the draft invoice exists). Admin can finalize
  // + send manually from the Invoices panel as a fallback.
  const stripeInvoiceId = accept.body?.invoice || null;
  let invoiceHostedUrl: string | null = null;
  let invoiceNumber: string | null = null;
  if (stripeInvoiceId) {
    try {
      const finalised = await stripeRequest<{ id: string; number: string | null; hosted_invoice_url: string | null }>(
        'POST',
        `invoices/${encodeURIComponent(stripeInvoiceId)}/finalize`,
        null,
        secretKey,
        `slg-quote-invoice-finalize-${q.id}`,
      );
      if (finalised.ok) {
        invoiceHostedUrl = finalised.body?.hosted_invoice_url || null;
        invoiceNumber = finalised.body?.number || null;
        // Send the Stripe-hosted "Pay this invoice" email. Idempotent on
        // Stripe's side — calling /send twice doesn't double-mail.
        const sent = await stripeRequest(
          'POST',
          `invoices/${encodeURIComponent(stripeInvoiceId)}/send`,
          null,
          secretKey,
          `slg-quote-invoice-send-${q.id}`,
        );
        if (!sent.ok) {
          console.warn('invoice /send returned non-ok:', sent.error);
        }
      } else {
        console.warn('invoice /finalize after quote-accept failed:', finalised.error);
      }
    } catch (e) {
      console.error('invoice finalize+send after quote-accept threw:', e);
    }
  }

  return jsonResponse({
    ok: true,
    accepted_at: nowIso,
    // Frontend surfaces these so the recipient sees "Your invoice
    // SLG-NNNN is ready — Pay now" with a real deep-link rather than
    // the generic "we've emailed you" message.
    invoice_number: invoiceNumber,
    invoice_hosted_url: invoiceHostedUrl,
  });
}

// deno-lint-ignore no-explicit-any
async function actDecline(sb: any, quoteId: string, auth: { status?: string | null; terminalStatus?: boolean }, reason: string | null) {
  if (auth.terminalStatus) {
    return jsonResponse({ ok: false, error: `This quote is already ${auth.status}.` }, 409);
  }
  const { data: q } = await sb.from('quotes')
    .select('id, stripe_quote_id, submission_id, external_contact_id, number')
    .eq('id', quoteId)
    .maybeSingle();
  if (!q?.stripe_quote_id) return jsonResponse({ ok: false, error: 'Quote not finalised at Stripe.' }, 409);

  const mode = await getStripeMode();
  const secretKey = getStripeKey(mode);

  // Stamp the reason metadata BEFORE the cancel so the webhook handler
  // reads it and classifies the cancel as 'declined' (recipient-initiated)
  // rather than 'cancelled' (admin-initiated).
  await stripeRequest(
    'POST',
    `quotes/${encodeURIComponent(q.stripe_quote_id)}`,
    { 'metadata[cancel_reason]': 'client_declined' },
    secretKey,
  );
  const cancel = await stripeRequest(
    'POST',
    `quotes/${encodeURIComponent(q.stripe_quote_id)}/cancel`,
    null,
    secretKey,
    `slg-quote-decline-${q.id}`,
  );
  if (!cancel.ok) {
    console.error('Stripe quote decline (cancel) failed:', cancel.error);
    return jsonResponse({
      ok: false,
      error: 'We could not record your decline. Please try again, or reply to the quote email.',
    }, 502);
  }

  const nowIso = new Date().toISOString();
  await sb.from('quotes')
    .update({
      status: 'declined',
      declined_at: nowIso,
      decline_reason: reason ? reason.trim().slice(0, 500) : null,
    })
    .eq('id', q.id)
    .in('status', ['sent', 'viewed']);

  try {
    await sb.from('activity_log').insert({
      submission_id: q.submission_id,
      action: 'quote_declined',
      actor: 'client',
      details: {
        quote_id: q.id,
        stripe_quote_id: q.stripe_quote_id,
        number: q.number,
        external_contact_id: q.external_contact_id,
        reason: reason || null,
      },
    });
  } catch (e) { console.error('activity_log insert failed:', e); }

  return jsonResponse({ ok: true, declined_at: nowIso });
}
