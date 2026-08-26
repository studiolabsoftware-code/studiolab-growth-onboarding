// Public pricing preview. Used by the studio-facing form on the final step
// to show subtotal/GST/total before payment. No DB writes — purely a view of
// the current catalog + an optional discount code validation.
//
// REGION. There are two commercial lines, Australia and everyone else, priced
// from independently set catalogs. When a session token is presented we derive
// the line from the SUBMISSION using the same `pricingCountryFor` that
// create-checkout-session uses, so the price shown here and the price actually
// charged are produced by one function and cannot disagree. Before this, the
// preview trusted a client-supplied `country`, so a studio who reached the /au/
// form directly would be shown AUD here and charged USD at checkout.
//
// The session token is optional: without one this stays the anonymous catalog
// view it has always been, which the form relies on before the studio has
// verified their email.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { resolvePricing } from '../_shared/pricing.ts';
import { pricingCountryFor } from '../_shared/region-guard.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const plan = String(body.plan || '');
    const setup_type = String(body.setup_type || '');
    const discount_code = body.discount_code ? String(body.discount_code) : null;
    const sessionToken = body.session_token ? String(body.session_token) : '';
    let country = body.country ? String(body.country) : null;

    if (!['launch', 'scale', 'ai'].includes(plan)) {
      return jsonResponse({ ok: false, error: 'Invalid plan.' }, 400);
    }
    if (!['dfy', 'guided'].includes(setup_type)) {
      return jsonResponse({ ok: false, error: 'Invalid setup type.' }, 400);
    }

    // Server-derived line, when we can identify the studio. This overrides the
    // client-supplied country deliberately: the browser's value is whatever the
    // URL implied, which is the thing being corrected. A token that does not
    // match simply falls through to the anonymous view rather than erroring,
    // because this endpoint must never be able to block a price from rendering.
    if (sessionToken) {
      try {
        const sb = adminClient();
        const { data: sub } = await sb.from('submissions')
          .select('country, contact_phone, address_postcode')
          .eq('session_token_hash', await sha256Hex(sessionToken))
          .maybeSingle();
        if (sub) {
          country = pricingCountryFor({
            country: (sub.country as string | null) ?? country,
            contactPhone: sub.contact_phone as string | null,
            addressPostcode: sub.address_postcode as string | null,
          }).country;
        }
      } catch (e) {
        console.error('resolve-pricing: region derivation failed, falling back to the supplied country:', e);
      }
    }

    const result = await resolvePricing({
      plan: plan as 'launch' | 'scale' | 'ai',
      setup_type: setup_type as 'dfy' | 'guided',
      country,
      discount_code,
    });

    if (!result.ok) {
      // Discount-code errors are user-facing — return 200 with ok:false so the
      // form can surface them inline without throwing a network error.
      const status = (result.code && result.code.startsWith('discount_')) ? 200 : 400;
      return jsonResponse(result, status);
    }
    return jsonResponse(result);
  } catch (err) {
    console.error('resolve-pricing error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
