// Owner-only writer for the singleton payment_settings row. Accepts a partial
// patch — any field omitted from the body is left untouched. Validates each
// field before writing so a malformed UI call cannot corrupt the singleton.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';

const VALID_MODES = new Set(['test', 'live']);
const VALID_PAYMENT_MODES = new Set(['immediate', 'hold', 'save_card']);
const VALID_STAGES = new Set([
  'submitted', 'in_review', 'changes_requested', 'setup_in_progress', 'complete',
]);

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Not authorised.' }, 401);
    if (caller.role !== 'owner') {
      return jsonResponse({ ok: false, error: 'Only the owner can change payment settings.' }, 403);
    }

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_by: caller.id };

    if (typeof body.stripe_mode === 'string') {
      if (!VALID_MODES.has(body.stripe_mode)) {
        return jsonResponse({ ok: false, error: 'stripe_mode must be "test" or "live".' }, 400);
      }
      patch.stripe_mode = body.stripe_mode;
    }

    if ('stripe_publishable_key_test' in body) {
      const v = body.stripe_publishable_key_test;
      if (v !== null && typeof v !== 'string') {
        return jsonResponse({ ok: false, error: 'stripe_publishable_key_test must be a string or null.' }, 400);
      }
      const trimmed = typeof v === 'string' ? v.trim() : null;
      if (trimmed && !/^pk_test_/.test(trimmed)) {
        return jsonResponse({ ok: false, error: 'Test publishable key must start with pk_test_.' }, 400);
      }
      patch.stripe_publishable_key_test = trimmed || null;
    }

    if ('stripe_publishable_key_live' in body) {
      const v = body.stripe_publishable_key_live;
      if (v !== null && typeof v !== 'string') {
        return jsonResponse({ ok: false, error: 'stripe_publishable_key_live must be a string or null.' }, 400);
      }
      const trimmed = typeof v === 'string' ? v.trim() : null;
      if (trimmed && !/^pk_live_/.test(trimmed)) {
        return jsonResponse({ ok: false, error: 'Live publishable key must start with pk_live_.' }, 400);
      }
      patch.stripe_publishable_key_live = trimmed || null;
    }

    if (typeof body.default_payment_mode === 'string') {
      if (!VALID_PAYMENT_MODES.has(body.default_payment_mode)) {
        return jsonResponse({ ok: false, error: 'default_payment_mode must be immediate, hold, or save_card.' }, 400);
      }
      patch.default_payment_mode = body.default_payment_mode;
    }

    if (typeof body.auto_capture_stage === 'string') {
      if (!VALID_STAGES.has(body.auto_capture_stage)) {
        return jsonResponse({ ok: false, error: 'auto_capture_stage is not a known submission stage.' }, 400);
      }
      patch.auto_capture_stage = body.auto_capture_stage;
    }

    if (Object.keys(patch).length === 1) {
      return jsonResponse({ ok: false, error: 'Nothing to update.' }, 400);
    }

    const sb = adminClient();
    const { data, error } = await sb.from('payment_settings')
      .update(patch)
      .eq('id', 1)
      .select('*')
      .maybeSingle();
    if (error) throw error;

    return jsonResponse({ ok: true, settings: data });
  } catch (err) {
    console.error('save-payment-settings error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
