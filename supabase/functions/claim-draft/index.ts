// Bridges generic-mode OTP verification to a plan-specific draft. The studio
// already proved email ownership via verify-otp (which returned a 5-minute
// verified_token). They picked a plan + region. This function claims or
// creates the draft for that combination and returns a 90-day session token.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex, randomToken } from '../_shared/supabase.ts';

// Match verify-otp: studios should be able to resume a draft weeks later.
const SESSION_TTL_HOURS = 24 * 90;
const ALLOWED_PLANS  = new Set(['launch', 'scale', 'ai']);
const ALLOWED_REGIONS = new Set(['AU', 'US']);

function isValidEmail(v: string): boolean {
  // `%`, `*` and `\\` are never legitimate in an address and are all LIKE/PostgREST metacharacters.
  // Defence in depth behind the .eq() lookups below.
  if (/[%*\\]/.test(String(v))) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const { email, verified_token, plan, region } = await req.json();
    if (!email || !isValidEmail(email)) return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
    if (!verified_token || typeof verified_token !== 'string') {
      return jsonResponse({ ok: false, error: 'Missing verification token.' }, 400);
    }
    if (!ALLOWED_PLANS.has(plan)) return jsonResponse({ ok: false, error: 'Unknown plan.' }, 400);
    if (!ALLOWED_REGIONS.has(region)) return jsonResponse({ ok: false, error: 'Unknown region.' }, 400);

    const normEmail = String(email).trim().toLowerCase();
    const sb = adminClient();

    // Validate the verified_token: look for an unused row in studio_otps with
    // code_hash = 'verified:' + sha256(verified_token), not expired.
    const verifiedHash = 'verified:' + (await sha256Hex(verified_token));
    const { data: marker } = await sb.from('studio_otps')
      .select('*')
      .eq('email', normEmail)
      .eq('code_hash', verifiedHash)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (!marker) {
      return jsonResponse({ ok: false, error: 'Verification expired. Please verify your email again.' }, 401);
    }

    // Burn the marker so it cannot be reused
    await sb.from('studio_otps').update({ used_at: new Date().toISOString() }).eq('id', marker.id);

    // Find or create the draft for (email, plan, region)
    const { data: existing } = await sb
      .from('submissions')
      .select('*')
      .eq('contact_email', normEmail)
      .eq('plan', plan)
      .eq('region', region)
      .maybeSingle();

    const sessionTokenRaw = randomToken(32);
    const sessionTokenHash = await sha256Hex(sessionTokenRaw);
    const sessionExpires = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

    let submission;
    if (existing) {
      const { data: updated, error } = await sb.from('submissions')
        .update({
          session_token_hash: sessionTokenHash,
          session_expires_at: sessionExpires,
          last_saved_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single();
      if (error) throw error;
      submission = updated;
    } else {
      const { data: created, error } = await sb.from('submissions')
        .insert({
          contact_email: normEmail,
          plan,
          region,
          status: 'draft',
          verified_at: new Date().toISOString(),
          last_saved_at: new Date().toISOString(),
          session_token_hash: sessionTokenHash,
          session_expires_at: sessionExpires,
        })
        .select('*')
        .single();
      if (error) throw error;
      submission = created;
    }

    const { session_token_hash: _h, ...safe } = submission;
    return jsonResponse({
      ok: true,
      session_token: sessionTokenRaw,
      session_expires_at: sessionExpires,
      submission: safe,
    });
  } catch (err) {
    console.error('claim-draft error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
