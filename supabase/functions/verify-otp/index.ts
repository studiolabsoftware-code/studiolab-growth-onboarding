// Verifies a 6-digit OTP for an email. On success: finds or creates the draft
// submission for (email, plan, region), issues a 24h session token, returns
// the draft data so the form can hydrate.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex, randomToken } from '../_shared/supabase.ts';

const SESSION_TTL_HOURS = 24;
const MAX_ATTEMPTS = 5;
const ALLOWED_PLANS  = new Set(['launch', 'scale', 'ai']);
const ALLOWED_REGIONS = new Set(['AU', 'US']);

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const { email, code, plan, region } = await req.json();
    if (!email || !isValidEmail(email)) return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
    if (!code || !/^\d{6}$/.test(String(code))) return jsonResponse({ ok: false, error: 'Code must be 6 digits.' }, 400);
    if (!ALLOWED_PLANS.has(plan)) return jsonResponse({ ok: false, error: 'Unknown plan.' }, 400);
    if (!ALLOWED_REGIONS.has(region)) return jsonResponse({ ok: false, error: 'Unknown region.' }, 400);

    const normEmail = String(email).trim().toLowerCase();
    const sb = adminClient();

    // Find latest unused OTP for this email
    const { data: otp } = await sb
      .from('studio_otps')
      .select('*')
      .ilike('email', normEmail)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otp) return jsonResponse({ ok: false, error: 'No active code. Request a new one.' }, 400);

    if (otp.attempts >= MAX_ATTEMPTS) {
      return jsonResponse({ ok: false, error: 'Too many attempts. Request a new code.' }, 429);
    }

    const incomingHash = await sha256Hex(String(code));
    if (incomingHash !== otp.code_hash) {
      await sb.from('studio_otps').update({ attempts: otp.attempts + 1 }).eq('id', otp.id);
      return jsonResponse({ ok: false, error: 'Code is incorrect.' }, 400);
    }

    // Mark OTP used
    await sb.from('studio_otps').update({ used_at: new Date().toISOString() }).eq('id', otp.id);

    // Find or create draft submission for (email, plan, region)
    const { data: existing } = await sb
      .from('submissions')
      .select('*')
      .ilike('contact_email', normEmail)
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
          verified_at: existing.verified_at || new Date().toISOString(),
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

    // Strip server-only fields before returning
    const { session_token_hash: _h, ...safe } = submission;

    return jsonResponse({
      ok: true,
      session_token: sessionTokenRaw,
      session_expires_at: sessionExpires,
      submission: safe,
      is_returning: Boolean(existing),
    });
  } catch (err) {
    console.error('verify-otp error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
