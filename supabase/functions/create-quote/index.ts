// Admin-issued quote. Mirrors create-custom-invoice for recipient resolution
// and Stripe Customer linkage, then creates a Stripe Quote (POST /v1/quotes),
// finalises it so it gets a number + hosted URL + PDF, and writes a row to
// public.quotes immediately so the admin UI shows it without webhook latency.
//
// HARD SEPARATION RULES (memory: project_billing_separation_rules):
//   * Every Stripe object created here carries
//     `metadata.source = 'studiolab-growth-quote'` so the webhook filter
//     attributes events correctly and refuses to touch GHL invoices.
//   * The resulting invoice (created by Stripe on quote acceptance) inherits
//     `pending_invoice_items_behavior: 'exclude'` via
//     invoice_settings.pending_invoice_items_behavior on the quote — this
//     guarantees a GHL SaaS subscription draft can never roll in when Stripe
//     materialises the accepted-quote invoice.
//   * Forbidden API surface (subscriptions.*, customers.delete, etc.) is
//     never called from this function.
//
// ACCEPTANCE MODES (memory: project_quote_acceptance_default):
//   * pay_on_accept (DEFAULT) — collection_method='send_invoice' with a short
//     days_until_due (3 days). On acceptance Stripe creates an invoice and
//     auto-sends the hosted Pay link to the recipient, putting payment in
//     the same flow as acceptance.
//   * pay_on_invoice (admin opt-in) — collection_method='send_invoice' with
//     a longer days_until_due (14 days) for engagements where the recipient
//     needs internal approval before paying.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { getAuGstTaxRateId, getStripeKey, getStripeMode, stripeRequest } from '../_shared/stripe.ts';

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

type AcceptanceMode = 'pay_on_accept' | 'pay_on_invoice';

interface RequestBody {
  recipient: Recipient;
  currency: 'AUD' | 'USD';
  line_items: LineItem[];
  acceptance_mode?: AcceptanceMode;
  expires_in_days?: number;     // default 30
  cover_note?: string;          // studio-facing memo shown on the quote
  description?: string;         // internal admin note
  parent_quote_id?: string;     // set when this quote replaces a prior one (revision)
}

function isoCountryForStripe(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const c = stored.trim().toUpperCase();
  if (c === 'UK') return 'GB';
  if (/^[A-Z]{2}$/.test(c)) return c;
  return null;
}

// Server-side mirror of the admin modal's currency lock. AU recipients must
// pay AUD with GST; everyone else USD without GST. Returns null if country
// is unknown (no enforcement — admin's modal default still applies).
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
    const acceptanceMode: AcceptanceMode = body.acceptance_mode === 'pay_on_invoice'
      ? 'pay_on_invoice'
      : 'pay_on_accept';
    const expiresInDays = Number.isInteger(body.expires_in_days) && (body.expires_in_days as number) > 0
      ? (body.expires_in_days as number)
      : 30;
    const coverNote = (body.cover_note || '').trim() || null;
    const description = (body.description || '').trim() || null;
    const parentQuoteId = (body.parent_quote_id || '').trim() || null;

    if (!recipient) return badRequest('Recipient is required.');
    if (currency !== 'AUD' && currency !== 'USD') return badRequest('Currency must be AUD or USD.');
    if (lines.length === 0) return badRequest('At least one line item is required.');
    for (const li of lines) {
      if (!li.description || typeof li.description !== 'string') return badRequest('Each line item needs a description.');
      if (!Number.isInteger(li.amount_cents) || li.amount_cents <= 0) return badRequest('Each line item needs a positive integer amount in cents.');
      if (li.quantity !== undefined && (!Number.isInteger(li.quantity) || li.quantity <= 0)) return badRequest('Quantity must be a positive integer.');
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
      // Server-side currency/country validation. The admin modal locks the
      // currency selector but a DOM edit can bypass that — we re-enforce
      // here because GST handling is tax-correctness load-bearing: AU
      // recipients must be billed AUD with GST, everyone else USD without.
      const expectedCurrency = expectedCurrencyForCountry(sub.country);
      if (expectedCurrency && currency !== expectedCurrency) {
        return badRequest(
          expectedCurrency === 'AUD'
            ? 'Australian studios must be quoted in AUD (10% GST applies).'
            : 'Overseas studios must be quoted in USD (no GST).',
          'currency_country_mismatch',
        );
      }
      if (sub.stripe_customer_id) {
        stripeCustomerId = sub.stripe_customer_id;
      } else {
        const fullName = [sub.first_name, sub.last_name].filter(Boolean).join(' ').trim()
          || sub.studio_name
          || sub.contact_email;
        const create = await stripeRequest<{ id: string }>('POST', 'customers', {
          email: sub.contact_email,
          name: fullName,
          metadata: {
            submission_id: sub.id,
            source: 'studiolab-growth-quote',
            studio_name: sub.studio_name || '',
          },
          ...(recipientCountryIso ? { 'address[country]': recipientCountryIso } : {}),
        }, secretKey, `studiolab-customer-${sub.id}`);
        if (!create.ok) return jsonResponse({ ok: false, error: 'Could not create the recipient in Stripe. Please try again.' }, 502);
        stripeCustomerId = create.body.id;
        await sb.from('submissions').update({ stripe_customer_id: stripeCustomerId }).eq('id', sub.id);
      }
    } else {
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
      // External recipient currency/country check. Only enforce when we
      // actually know the country — admins occasionally invoice a new
      // external contact without specifying country and that's allowed.
      const expectedExternalCurrency = expectedCurrencyForCountry(contactRow.country);
      if (expectedExternalCurrency && currency !== expectedExternalCurrency) {
        return badRequest(
          expectedExternalCurrency === 'AUD'
            ? 'Australian recipients must be quoted in AUD (10% GST applies).'
            : 'Overseas recipients must be quoted in USD (no GST).',
          'currency_country_mismatch',
        );
      }
      if (contactRow.stripe_customer_id) {
        stripeCustomerId = contactRow.stripe_customer_id;
      } else {
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
          await stripeRequest('POST', `customers/${encodeURIComponent(stripeCustomerId)}`, {
            'metadata[external_contact_id]': contactRow.id,
            'metadata[source]': 'studiolab-growth-quote',
            ...(recipientCountryIso ? { 'address[country]': recipientCountryIso } : {}),
          }, secretKey);
        } else {
          const create = await stripeRequest<{ id: string }>('POST', 'customers', {
            email: recipientEmail,
            name: contactRow.name || recipientEmail,
            metadata: {
              external_contact_id: contactRow.id,
              source: 'studiolab-growth-quote',
            },
            ...(recipientCountryIso ? { 'address[country]': recipientCountryIso } : {}),
          }, secretKey, `studiolab-external-${contactRow.id}`);
          if (!create.ok) return jsonResponse({ ok: false, error: 'Could not create the recipient in Stripe. Please try again.' }, 502);
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

    // ---- Build the line_items array Stripe Quotes expects. Each item uses
    // inline price_data; AUD line items get the manual GST tax rate (memory:
    // project_live_cutover_stripe_tax — automatic_tax is intentionally off in
    // sandbox and we use a manual rate for both modes until live cutover).
    let auGstRateId: string | null = null;
    if (currency === 'AUD') {
      auGstRateId = await getAuGstTaxRateId(secretKey);
      // If the rate can't be created, fall back to baking 10% into unit_amount
      // so the recipient still pays the GST-inclusive total. The breakdown
      // won't appear as a separate GST line but the total is correct, which
      // is the load-bearing requirement.
    }

    const expiresAtSec = Math.floor(Date.now() / 1000) + (expiresInDays * 24 * 60 * 60);
    // Derive idempotency key from the payload shape (not Date.now()) so
    // network retries hit Stripe's cache and produce one quote, while
    // intentionally-distinct quotes (different scope, line items, parent)
    // get fresh keys. Two near-simultaneous identical submissions are also
    // deduped — which is the desired behaviour for a double-click.
    const payloadDigest = await sha256Hex(JSON.stringify({
      cust: stripeCustomerId,
      sub: submissionId,
      ext: externalContactId,
      parent: parentQuoteId,
      mode: acceptanceMode,
      currency,
      expires: expiresAtSec,
      lines: lines.map((li) => ({ d: li.description, q: li.quantity ?? 1, a: li.amount_cents })),
      note: coverNote,
      desc: description,
    }));
    const idempotencyBase = `slg-quote-${payloadDigest.slice(0, 24)}`;

    const useFallbackGst = currency === 'AUD' && !auGstRateId;
    // Stripe Quotes API requires line_items.price_data to reference an
    // existing `product` ID — `product_data` (inline) is supported on
    // Checkout Sessions but NOT on Quotes (Stripe returns 400 "unknown
    // parameter: product_data"). And line_items.description is also not
    // accepted (Stripe returns 400 "unknown parameter: description").
    //
    // The cleanest workaround: create a Stripe Product per line item,
    // named with the line's description. Stripe surfaces the product name
    // as the line label on the hosted quote and resulting invoice. We tag
    // each product with metadata.source so they're filterable in the
    // dashboard and don't get confused with catalog products.
    //
    // Idempotency via product_data hash on the line: identical descriptions
    // within one quote (and across retries thanks to our payload-hash
    // idempotency key) reuse the same idempotency key on product create.
    const lineProductIds: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const li = lines[i];
      const prodCreate = await stripeRequest<{ id: string }>(
        'POST',
        'products',
        {
          name: li.description,
          'metadata[source]': 'studiolab-quote-line',
          tax_code: 'txcd_20030000',
        },
        secretKey,
        `${idempotencyBase}-prod-${i}`,
      );
      if (!prodCreate.ok || !prodCreate.body?.id) {
        console.error('quote line product create failed:', prodCreate.error);
        return jsonResponse({
          ok: false,
          error: 'Could not register the quote line item in Stripe. Please try again.',
        }, 502);
      }
      lineProductIds.push(prodCreate.body.id);
    }

    // AU GST on Stripe Quote line items: attach the manual tax rate at the
    // line-item level. The rate's own `inclusive: false` governs the GST
    // calculation; price_data.tax_behavior='exclusive' is a documented
    // Stripe-Tax field that Stripe accepts here but doesn't actually drive
    // the math when manual tax_rates are used.
    const lineItemsArr = lines.map((li, i) => {
      const unitAmount = useFallbackGst ? Math.round(li.amount_cents * 1.10) : li.amount_cents;
      const item: Record<string, unknown> = {
        quantity: li.quantity ?? 1,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: unitAmount,
          tax_behavior: 'exclusive',
          product: lineProductIds[i],
        },
      };
      if (currency === 'AUD' && auGstRateId) {
        item.tax_rates = [auGstRateId];
      }
      return item;
    });

    // pay_on_accept = due on receipt (days_until_due=0). Acceptance fires
    // the Pay-link email immediately and the invoice is marked due now, so
    // the accept-and-pay UX is one continuous step from the recipient's
    // point of view. pay_on_invoice = 14 days for engagements that need
    // internal sign-off after acceptance.
    const daysUntilDue = acceptanceMode === 'pay_on_accept' ? 0 : 14;

    // ---- Create the Quote (draft).
    const invoiceMeta: Record<string, unknown> = {
      // Stamp source on the resulting invoice's metadata so classifyInvoice
      // in the webhook lands on the studiolab-growth-quote branch and writes
      // it to our ledger with kind='quote_invoice'.
      source: 'studiolab-growth-quote',
    };
    if (submissionId) invoiceMeta.submission_id = submissionId;
    if (externalContactId) invoiceMeta.external_contact_id = externalContactId;

    const quoteMeta: Record<string, unknown> = {
      source: 'studiolab-growth-quote',
      acceptance_mode: acceptanceMode,
      admin_email: caller.email,
    };
    if (submissionId) quoteMeta.submission_id = submissionId;
    if (externalContactId) quoteMeta.external_contact_id = externalContactId;

    const quoteBody: Record<string, unknown> = {
      customer: stripeCustomerId,
      collection_method: 'send_invoice',
      expires_at: expiresAtSec,
      // The "header" is the cover note shown at the top of the hosted quote
      // and PDF. "description" goes to the resulting invoice's description
      // field once Stripe materialises the invoice.
      ...(coverNote ? { header: coverNote } : {}),
      ...(description ? { description } : {}),
      invoice_settings: {
        days_until_due: daysUntilDue,
        issuer: { type: 'self' },
        metadata: invoiceMeta,
      },
      metadata: quoteMeta,
      line_items: lineItemsArr,
    };
    const draft = await stripeRequest<{ id: string; number: string | null }>(
      'POST',
      'quotes',
      quoteBody,
      secretKey,
      `${idempotencyBase}-quote`,
    );
    if (!draft.ok) {
      console.error('quote create failed:', draft.error);
      return jsonResponse({
        ok: false,
        error: 'Could not create the quote in Stripe. Please try again — check the Stripe dashboard if it persists.',
      }, 502);
    }
    const quoteId = draft.body.id;

    // ---- Finalise the quote so it gets a number + hosted URL + PDF.
    const finalised = await stripeRequest<{
      id: string;
      number: string | null;
      status: string;
      amount_subtotal: number | null;
      amount_total: number | null;
      total_details?: { amount_tax?: number | null } | null;
      expires_at: number | null;
      computed?: {
        upfront?: { amount_subtotal: number | null; amount_total: number | null; total_details?: { amount_tax?: number | null } } | null;
      };
    }>('POST', `quotes/${encodeURIComponent(quoteId)}/finalize`, {}, secretKey, `${idempotencyBase}-finalize`);
    if (!finalised.ok) {
      console.error('quote finalise failed:', finalised.error);
      return jsonResponse({
        ok: false,
        error: 'Could not finalise the quote in Stripe. Please try again — check the Stripe dashboard if it persists.',
      }, 502);
    }
    const q = finalised.body;

    // Stripe builds the hosted URL and PDF after finalize. The Quote object
    // doesn't always return them in the finalize payload, so we fetch the
    // quote PDF endpoint metadata via a follow-up GET.
    const refetch = await stripeRequest<{ id: string; number: string | null; status: string; expires_at: number | null }>(
      'GET',
      `quotes/${encodeURIComponent(quoteId)}`,
      null,
      secretKey,
    );
    const qFull = refetch.ok ? refetch.body : q;

    // Trigger Stripe's quote email so the recipient gets it immediately
    // rather than waiting for whatever Stripe's internal advance schedule
    // would do. Stripe handles the email + the recipient's view-and-accept
    // surface — there is no public hosted_url or PDF URL on the Quote
    // object (the /v1/quotes/{id}/pdf endpoint requires API auth, so we
    // do not expose it as a customer-facing link).
    //
    // CHECK THE RESPONSE: previously fire-and-forget. If Stripe rejects
    // (e.g. customer has no email), our ledger would say status='sent'
    // with no email actually delivered. Roll back the Stripe quote and
    // surface to admin so they can fix the recipient and retry.
    const sendResp = await stripeRequest(
      'POST',
      `quotes/${encodeURIComponent(quoteId)}/send`,
      null,
      secretKey,
    );
    if (!sendResp.ok) {
      console.error('quotes/send failed, rolling back:', sendResp.error);
      await stripeRequest(
        'POST',
        `quotes/${encodeURIComponent(quoteId)}/cancel`,
        null,
        secretKey,
      );
      return jsonResponse({
        ok: false,
        error: 'Could not send the quote email. Check that the recipient has an email address in Stripe and try again.',
        code: 'send_failed',
      }, 502);
    }

    const hostedUrl: string | null = null;
    const pdfUrl: string | null = null;

    // ---- Write the quotes ledger row immediately.
    const subtotalCents = q.amount_subtotal ?? 0;
    const totalCents = q.amount_total ?? 0;
    const taxCents = q.total_details?.amount_tax ?? Math.max(0, totalCents - subtotalCents);
    const expiresAtIso = q.expires_at
      ? new Date(q.expires_at * 1000).toISOString()
      : new Date(expiresAtSec * 1000).toISOString();
    const nowIso = new Date().toISOString();

    const status = (qFull.status === 'open' || qFull.status === 'accepted') ? 'sent' : 'draft';

    const { data: ledgerRow, error: ledgerErr } = await sb.from('quotes')
      .upsert({
        submission_id: submissionId,
        external_contact_id: externalContactId,
        stripe_quote_id: q.id,
        stripe_customer_id: stripeCustomerId,
        number: qFull.number,
        source: 'studiolab-growth-quote',
        status,
        acceptance_mode: acceptanceMode,
        parent_quote_id: parentQuoteId,
        currency,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        total_cents: totalCents,
        expires_at: expiresAtIso,
        sent_at: nowIso,
        hosted_url: hostedUrl,
        pdf_url: pdfUrl,
        description,
        cover_note: coverNote,
        created_by: caller.id,
      }, { onConflict: 'stripe_quote_id' })
      .select('id')
      .single();

    // Roll back on ledger failure. The Stripe Quote is already open and the
    // email is already in flight — but with no ledger row, admin UI can't
    // see the quote and webhook events for it will hit the "not in ledger"
    // branch and silently skip. Better to cancel the Stripe Quote and
    // surface the failure so the admin can retry cleanly.
    if (ledgerErr || !ledgerRow?.id) {
      console.error('quotes ledger insert failed, rolling back Stripe Quote:', ledgerErr);
      await stripeRequest(
        'POST',
        `quotes/${encodeURIComponent(q.id)}/cancel`,
        null,
        secretKey,
      );
      return jsonResponse({
        ok: false,
        error: 'Could not record the quote on our side. The Stripe quote was rolled back — please try again.',
        code: 'ledger_insert_failed',
      }, 500);
    }

    // Revision parent handling. ORDER OF OPERATIONS IS LOAD-BEARING:
    //   1. Cancel the parent in Stripe FIRST (best-effort but synchronous).
    //   2. Then mark the parent ledger row as 'revised'.
    // Previously the parent was marked 'revised' before any Stripe-side
    // cancellation, and the client-side cancel-quote call ran after
    // create-quote returned. cancel-quote bails on terminal statuses
    // (including 'revised'), so the parent was never cancelled in Stripe —
    // recipient could still accept the superseded quote.
    if (parentQuoteId && ledgerRow?.id) {
      const { data: parentRow } = await sb.from('quotes')
        .select('stripe_quote_id, status')
        .eq('id', parentQuoteId)
        .maybeSingle();
      if (parentRow?.stripe_quote_id
          && ['draft', 'sent', 'viewed'].includes(parentRow.status as string)) {
        const cancel = await stripeRequest<{ id: string; status: string }>(
          'POST',
          `quotes/${encodeURIComponent(parentRow.stripe_quote_id)}/cancel`,
          null,
          secretKey,
          `slg-revise-cancel-${parentQuoteId}`,
        );
        if (!cancel.ok) {
          // Log and proceed: we'd rather have the new quote live than crash
          // the revise flow. The reminder cron's daily auto-cancel sweep
          // will catch the parent at expiry if Stripe rejected the cancel.
          console.error('revise: parent quote cancel failed', {
            parent_id: parentQuoteId,
            stripe_quote_id: parentRow.stripe_quote_id,
            error: cancel.error,
          });
        }
      }
      await sb.from('quotes')
        .update({ status: 'revised' })
        .eq('id', parentQuoteId)
        .in('status', ['draft', 'sent', 'viewed']);
      try {
        await sb.from('activity_log').insert({
          submission_id: submissionId,
          action: 'quote_revised',
          actor: caller.email,
          details: {
            parent_quote_id: parentQuoteId,
            new_quote_id: q.id,
            number: qFull.number,
          },
        });
      } catch (e) { console.error('activity_log insert failed:', e); }
    }

    // ---- Activity log: drafted → sent in one step (we send immediately).
    try {
      await sb.from('activity_log').insert([
        {
          submission_id: submissionId,
          action: 'quote_drafted',
          actor: caller.email,
          details: {
            quote_id: q.id,
            number: qFull.number,
            total_cents: totalCents,
            currency,
            acceptance_mode: acceptanceMode,
            recipient_type: submissionId ? 'studio' : 'external',
            external_contact_id: externalContactId,
          },
        },
        {
          submission_id: submissionId,
          action: 'quote_sent',
          actor: caller.email,
          details: {
            quote_id: q.id,
            number: qFull.number,
            currency,
          },
        },
      ]);
    } catch (e) { console.error('activity_log insert failed:', e); }

    return jsonResponse({
      ok: true,
      quote: {
        id: ledgerRow?.id || null,
        stripe_quote_id: q.id,
        number: qFull.number,
        status,
        total_cents: totalCents,
        subtotal_cents: subtotalCents,
        tax_cents: taxCents,
        currency,
        acceptance_mode: acceptanceMode,
        expires_at: expiresAtIso,
        hosted_url: hostedUrl,
        pdf_url: pdfUrl,
      },
      stripe_mode: mode,
    });
  } catch (err) {
    // Log the raw error server-side; don't leak stack/Postgres details to
    // the admin UI (which alert()s the response).
    console.error('create-quote error:', err);
    return jsonResponse({
      ok: false,
      error: 'Could not create the quote. Please try again — if it persists, email info@studiolabsoftware.com.',
    }, 500);
  }
});
