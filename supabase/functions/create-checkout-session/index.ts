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
import { resolvePricing } from '../_shared/pricing.ts';
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

async function findOrCreateCustomer(
  submission: Submission,
  secretKey: string,
): Promise<{ id: string } | { error: string }> {
  if (submission.stripe_customer_id) {
    // Trust the stored id; Stripe will fail loudly on the session create if
    // it's stale and we'll surface that error.
    return { id: submission.stripe_customer_id };
  }
  // Search by email metadata to dedupe across draft retries.
  const search = await stripeRequest<{ data: Array<{ id: string }> }>(
    'GET',
    `customers/search?query=${encodeURIComponent(`metadata['submission_id']:'${submission.id}'`)}`,
    null,
    secretKey,
  );
  if (search.ok && search.body.data && search.body.data.length) {
    return { id: search.body.data[0].id };
  }
  const fullName = [submission.first_name, submission.last_name].filter(Boolean).join(' ').trim()
    || submission.studio_name
    || submission.contact_email;
  const create = await stripeRequest<{ id: string }>(
    'POST',
    'customers',
    {
      email: submission.contact_email,
      name: fullName,
      metadata: {
        submission_id: submission.id,
        studio_name: submission.studio_name || '',
      },
    },
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

    // Build the Checkout Session. Inline price_data — Stripe Products carry
    // names/descriptions for reporting only; the amount + currency live
    // here, snapshotted from our catalog at this moment.
    const lineItem: Record<string, unknown> = {
      quantity: 1,
      price_data: {
        currency: pricing.currency.toLowerCase(),
        unit_amount: pricing.final_amount_cents,
        product_data: pricing.stripe_product_id ? undefined : {
          name: pricing.product_name,
          description: pricing.product_description || undefined,
          tax_code: pricing.tax_code,
          metadata: {
            studiolab_product_id: pricing.product_id,
          },
        },
        product: pricing.stripe_product_id || undefined,
        tax_behavior: 'exclusive',
      },
    };

    const isSetup = paymentMode === 'save_card';
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
      },
      automatic_tax: { enabled: true },
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
