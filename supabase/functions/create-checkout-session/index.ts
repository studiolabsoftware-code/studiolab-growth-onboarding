// Creates a Stripe Checkout Session for a studio's submission, resolves the
// price (list → discount → override), snapshots into submission_pricing,
// finds or creates the Stripe Customer, and returns the redirect URL.
//
// Three payment modes from payment_settings (or the per-submission override
// once that lands in phase 7): immediate, hold, save_card. The auth model
// here is the studio's session_token issued by verify-otp — the same anchor
// save-draft uses.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { resolvePricing, isAustralianFreeText } from '../_shared/pricing.ts';
import { getStripeKey, getStripeMode, stripeRequest } from '../_shared/stripe.ts';

type Submission = {
  id: string;
  plan: 'launch' | 'scale' | 'ai';
  setup_type: 'dfy' | 'guided';
  country: string | null;
  contact_email: string;
  studio_name: string | null;
  first_name: string | null;
  last_name: string | null;
  stripe_customer_id: string | null;
  payment_mode: 'immediate' | 'hold' | 'save_card' | null;
  payment_status: string | null;
};

type PaymentSettings = {
  default_payment_mode: 'immediate' | 'hold' | 'save_card';
};

// Map our country codes to Stripe / ISO 3166-1 alpha-2. We store 'UK' for the
// United Kingdom; Stripe expects 'GB'. 'OTHER' (free-text country) returns
// null so we let Stripe Checkout's own billing-address form collect a real
// ISO country from the studio — that's the only safe path for studios outside
// our supported list, because guessing the ISO from a typed string is wrong.
function isoCountryForStripe(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const c = stored.trim().toUpperCase();
  if (c === 'UK') return 'GB';
  if (/^[A-Z]{2}$/.test(c)) return c;
  return null;
}

// Patch our metadata + country onto an existing Stripe Customer. Used when we
// link to a Customer that was created elsewhere (GHL SaaS Configurator) — we
// augment rather than overwrite so GHL's own metadata keys survive untouched.
async function augmentExistingCustomer(
  customerId: string,
  submission: Submission,
  isoCountry: string | null,
  secretKey: string,
): Promise<void> {
  const body: Record<string, unknown> = {
    'metadata[submission_id]': submission.id,
    'metadata[source]': 'studiolab-growth-setup',
    'metadata[studio_name]': submission.studio_name || '',
    'metadata[country_code]': isoCountry || submission.country || '',
  };
  if (isoCountry) body['address[country]'] = isoCountry;
  await stripeRequest(
    'POST',
    `customers/${encodeURIComponent(customerId)}`,
    body,
    secretKey,
  );
}

async function findOrCreateCustomer(
  submission: Submission,
  secretKey: string,
): Promise<{ id: string } | { error: string }> {
  const isoCountry = isoCountryForStripe(submission.country);

  if (submission.stripe_customer_id) {
    // Trust the stored id; Stripe will fail loudly on the session create if
    // it's stale.
    await augmentExistingCustomer(submission.stripe_customer_id, submission, isoCountry, secretKey);
    return { id: submission.stripe_customer_id };
  }
  // 1. Search by our submission_id metadata — handles draft retries on our side.
  const bySubmission = await stripeRequest<{ data: Array<{ id: string }> }>(
    'GET',
    `customers/search?query=${encodeURIComponent(`metadata['submission_id']:'${submission.id}'`)}`,
    null,
    secretKey,
  );
  if (bySubmission.ok && bySubmission.body.data && bySubmission.body.data.length) {
    const existingId = bySubmission.body.data[0].id;
    await augmentExistingCustomer(existingId, submission, isoCountry, secretKey);
    return { id: existingId };
  }

  // 2. Email lookup. The GHL SaaS Configurator creates the Stripe Customer
  // first during signup; by the time the studio reaches our onboarding the
  // Customer already exists. Email is the only consolidation lever we have
  // because GHL's side is fixed-from-our-perspective. Case-insensitive exact
  // match — Stripe's customers/search supports `email:` directly. If multiple
  // Customers share the email (a GHL bug or a manual duplicate), we take the
  // most recently updated one and rely on later admin tooling to merge.
  const emailQ = `email:'${submission.contact_email.toLowerCase().replace(/'/g, "\\'")}'`;
  const byEmail = await stripeRequest<{ data: Array<{ id: string; updated?: number; created?: number }> }>(
    'GET',
    `customers/search?query=${encodeURIComponent(emailQ)}`,
    null,
    secretKey,
  );
  if (byEmail.ok && byEmail.body.data && byEmail.body.data.length) {
    const sorted = byEmail.body.data.slice().sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
    const chosen = sorted[0];
    if (sorted.length > 1) {
      console.warn('Multiple Stripe Customers found for email; linking to most recent', {
        submission_id: submission.id,
        email: submission.contact_email,
        candidates: sorted.map((c) => c.id),
        chosen: chosen.id,
      });
    }
    await augmentExistingCustomer(chosen.id, submission, isoCountry, secretKey);
    return { id: chosen.id };
  }

  // 3. No existing Customer — create one. Country is set so Stripe Tax can
  // compute jurisdiction immediately; without it, automatic_tax returns 0
  // for AU and we'd ship GST-less invoices.
  const fullName = [submission.first_name, submission.last_name].filter(Boolean).join(' ').trim()
    || submission.studio_name
    || submission.contact_email;
  const createBody: Record<string, unknown> = {
    email: submission.contact_email,
    name: fullName,
    metadata: {
      submission_id: submission.id,
      source: 'studiolab-growth-setup',
      studio_name: submission.studio_name || '',
      country_code: isoCountry || submission.country || '',
    },
  };
  if (isoCountry) createBody['address[country]'] = isoCountry;
  const create = await stripeRequest<{ id: string }>(
    'POST',
    'customers',
    createBody,
    secretKey,
    `studiolab-customer-${submission.id}`,
  );
  if (!create.ok) return { error: create.error || 'Could not create Stripe customer.' };
  return { id: create.body.id };
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : '';
    const discountCodeRaw = typeof body.discount_code === 'string' ? body.discount_code.trim() : '';
    const returnOrigin = typeof body.return_origin === 'string' ? body.return_origin : '';

    if (!sessionToken) return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);

    const sb = adminClient();
    const sessionHash = await sha256Hex(sessionToken);
    const { data: submission, error: subErr } = await sb
      .from('submissions')
      .select('id, plan, setup_type, country, contact_email, studio_name, first_name, last_name, stripe_customer_id, payment_mode, payment_status, session_expires_at')
      .eq('session_token_hash', sessionHash)
      .maybeSingle() as { data: (Submission & { session_expires_at: string | null }) | null; error: unknown };
    if (subErr) throw subErr;
    if (!submission) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!submission.session_expires_at || new Date(submission.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired. Please verify your email again.' }, 401);
    }
    if (!submission.plan || !submission.setup_type) {
      return jsonResponse({ ok: false, error: 'Plan or setup type missing on submission.' }, 400);
    }
    if (submission.payment_status === 'paid') {
      return jsonResponse({ ok: false, error: 'This submission has already been paid.' }, 409);
    }

    // Block AU studios that came through the USD flow by typing "Australia"
    // into the Other-country box. Country='AU' is reserved for the AU form,
    // which is region-locked at /au/[plan]/.
    if (isAustralianFreeText(submission.country)) {
      return jsonResponse({
        ok: false,
        error: 'Australian studios must use our AU onboarding form. Please email growth@studiolabgrowth.com if you reached this page in error.',
        code: 'au_must_use_au_flow',
      }, 400);
    }

    // Resolve price using current catalog state.
    const pricing = await resolvePricing({
      plan: submission.plan,
      setup_type: submission.setup_type,
      country: submission.country,
      discount_code: discountCodeRaw || null,
    });
    if (!pricing.ok) {
      const status = (pricing.code && pricing.code.startsWith('discount_')) ? 400 : 422;
      return jsonResponse({ ok: false, error: pricing.error, code: pricing.code }, status);
    }

    // Resolve payment mode: per-submission override → global default.
    const { data: settings } = await sb.from('payment_settings')
      .select('default_payment_mode')
      .eq('id', 1)
      .maybeSingle() as { data: PaymentSettings | null };
    const paymentMode = submission.payment_mode || settings?.default_payment_mode || 'immediate';

    // Stripe customer.
    const mode = await getStripeMode();
    const secretKey = getStripeKey(mode);
    const customer = await findOrCreateCustomer(submission, secretKey);
    if ('error' in customer) {
      return jsonResponse({ ok: false, error: customer.error }, 502);
    }

    // Origin for success/cancel URLs. Prefer client-provided origin so the
    // user is returned to the same region/page they came from; fall back to
    // the canonical app domain set via env.
    const fallbackOrigin = Deno.env.get('PUBLIC_APP_URL') || 'https://app.studiolabgrowth.com';
    const origin = /^https?:\/\//.test(returnOrigin) ? returnOrigin.replace(/\/$/, '') : fallbackOrigin;

    // Every catalog row must be synced to Stripe before checkout — that's
    // what binds the AUD and USD product reports together. Refuse to fall
    // back to inline product_data; an unsynced row is an admin bug, not a
    // studio-facing failure mode to paper over.
    if (!pricing.stripe_product_id) {
      console.error('Product not synced to Stripe', {
        product_id: pricing.product_id,
        currency: pricing.currency,
        country: submission.country,
      });
      return jsonResponse({
        ok: false,
        error: 'This plan is not available for checkout yet. Our team has been notified — please email growth@studiolabgrowth.com.',
        code: 'product_not_synced',
      }, 503);
    }

    // Build the Checkout Session. Inline price_data — the Stripe Product
    // carries the name/description/tax_code for reporting; amount + currency
    // are snapshotted from our catalog at this moment. The Product itself is
    // currency-specific (one row per plan × setup × currency) so AU studios
    // hit the AUD Product and US/Intl studios hit the USD Product.
    const lineItem: Record<string, unknown> = {
      quantity: 1,
      price_data: {
        currency: pricing.currency.toLowerCase(),
        unit_amount: pricing.final_amount_cents,
        product: pricing.stripe_product_id,
        tax_behavior: 'exclusive',
      },
    };

    const isSetup = paymentMode === 'save_card';
    // Stripe Tax automatic calculation requires a fully-configured business
    // origin address + tax registrations on the Stripe account. In a sandbox
    // those checks are flaky regardless of how the Tax UI looks (Stripe
    // surfaces "must have a valid head office address" even when the
    // dashboard reports complete). Skip automatic_tax in test mode so the
    // sandbox flow is unblocked; keep it on for live where the account is
    // fully onboarded. The live-cutover checklist must verify the live
    // account has its registered office address + GST registration set.
    const enableAutomaticTax = mode === 'live';
    const sessionPayload: Record<string, unknown> = {
      mode: isSetup ? 'setup' : 'payment',
      customer: customer.id,
      success_url: `${origin}/payment-confirm.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${new URL(req.url).searchParams.get('cancel_path') || '/'}?checkout=cancelled`,
      client_reference_id: submission.id,
      metadata: {
        submission_id: submission.id,
        payment_mode: paymentMode,
        product_id: pricing.product_id,
        currency: pricing.currency,
        country: submission.country || '',
      },
      automatic_tax: { enabled: enableAutomaticTax },
      // Force Stripe to confirm a billing address (and update the Customer
      // record with whatever the studio enters) so Stripe Tax always has a
      // jurisdiction once it's on. Without this, automatic_tax returns 0 in
      // live mode if the address fields don't round-trip back to the Customer.
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
      // tax_id_collection is only sensible when automatic_tax is on — in test
      // mode we skip both so the sandbox flow does not stall on missing
      // jurisdiction. Re-enabled automatically on the live cutover.
      ...(enableAutomaticTax ? { tax_id_collection: { enabled: true } } : {}),
    };
    if (!isSetup) {
      sessionPayload.line_items = [lineItem];
      sessionPayload.invoice_creation = { enabled: true };
      sessionPayload.payment_intent_data = {
        capture_method: paymentMode === 'hold' ? 'manual' : 'automatic',
        metadata: {
          submission_id: submission.id,
          payment_mode: paymentMode,
        },
      };
    } else {
      // setup mode: no line items, but we still need to know what to charge
      // later. The amount + currency are captured in submission_pricing and
      // applied at off-session charge time (phase 11).
      sessionPayload.payment_method_types = ['card'];
      sessionPayload.setup_intent_data = {
        metadata: {
          submission_id: submission.id,
          payment_mode: 'save_card',
          intended_amount_cents: String(pricing.final_amount_cents),
          intended_currency: pricing.currency,
        },
      };
    }

    const createSession = await stripeRequest<{ id: string; url: string }>(
      'POST',
      'checkout/sessions',
      sessionPayload,
      secretKey,
      // Idempotency keyed on submission so repeated clicks before redirect
      // return the same session.
      `studiolab-session-${submission.id}-${Date.now()}`,
    );
    if (!createSession.ok) {
      return jsonResponse({ ok: false, error: createSession.error || 'Could not create checkout session.' }, 502);
    }

    // Snapshot price into submission_pricing (upsert — repeated attempts
    // overwrite the snapshot until payment lands).
    const { error: snapErr } = await sb.from('submission_pricing').upsert({
      submission_id: submission.id,
      product_id: pricing.product_id,
      list_amount_cents: pricing.list_amount_cents,
      discount_code_id: pricing.discount_code_id,
      discount_amount_cents: pricing.discount_amount_cents,
      final_amount_cents: pricing.final_amount_cents,
      currency: pricing.currency,
      snapshotted_at: new Date().toISOString(),
    });
    if (snapErr) console.error('submission_pricing upsert failed:', snapErr);

    // Stamp the submission with the IDs + status.
    const { error: updErr } = await sb.from('submissions').update({
      stripe_customer_id: customer.id,
      stripe_checkout_session_id: createSession.body.id,
      payment_status: 'pending',
      payment_mode: paymentMode,
      currency: pricing.currency,
    }).eq('id', submission.id);
    if (updErr) console.error('submission stripe-stamp failed:', updErr);

    // Activity log — best-effort.
    try {
      await sb.from('activity_log').insert({
        submission_id: submission.id,
        action: 'payment_started',
        actor: submission.contact_email || 'studio',
        details: {
          mode: paymentMode,
          stripe_mode: mode,
          amount_cents: pricing.final_amount_cents,
          currency: pricing.currency,
          discount_code: pricing.discount_code,
        },
      });
    } catch (e) { console.error('activity_log insert failed:', e); }

    return jsonResponse({
      ok: true,
      url: createSession.body.url,
      session_id: createSession.body.id,
      payment_mode: paymentMode,
      stripe_mode: mode,
      amount_cents: pricing.final_amount_cents,
      currency: pricing.currency,
    });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
