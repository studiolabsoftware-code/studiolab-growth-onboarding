// Public pricing preview. Used by the studio-facing form on the final step
// to show subtotal/GST/total before payment. No DB writes — purely a view of
// the current catalog + an optional discount code validation.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { resolvePricing } from '../_shared/pricing.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const plan = String(body.plan || '');
    const setup_type = String(body.setup_type || '');
    const country = body.country ? String(body.country) : null;
    const discount_code = body.discount_code ? String(body.discount_code) : null;

    if (!['launch', 'scale', 'ai'].includes(plan)) {
      return jsonResponse({ ok: false, error: 'Invalid plan.' }, 400);
    }
    if (!['dfy', 'guided'].includes(setup_type)) {
      return jsonResponse({ ok: false, error: 'Invalid setup type.' }, 400);
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
