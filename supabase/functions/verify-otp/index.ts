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
    // Generic mode: caller does not yet know plan + region. We verify the OTP,
    // then either look up an existing draft for this email (if any) and return
    // it so the caller can route, or signal that a plan picker is needed.
    const generic = !plan && !region;
    if (!generic) {
      if (!ALLOWED_PLANS.has(plan)) return jsonResponse({ ok: false, error: 'Unknown plan.' }, 400);
      if (!ALLOWED_REGIONS.has(region)) return jsonResponse({ ok: false, error: 'Unknown region.' }, 400);
    }

    const normEmail = String(email).trim().toLowerCase();
    const sb = adminClient();

    // Match the code against any unused unexpired row for this email.
    // Multiple codes can coexist in the studio's inbox when delivery is slow
    // or they hit resend; the first one they paste should work.
    const { data: otpRows } = await sb
      .from('studio_otps')
      .select('*')
      .ilike('email', normEmail)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(10);
    const rows = otpRows || [];
    if (!rows.length) return jsonResponse({ ok: false, error: 'No active code. Request a new one.' }, 400);
    const newest = rows[0];
    if (newest.attempts >= MAX_ATTEMPTS) {
      return jsonResponse({ ok: false, error: 'Too many attempts. Request a new code.' }, 429);
    }

    const incomingHash = await sha256Hex(String(code));
    const otp = rows.find((r) => r.code_hash === incomingHash);
    if (!otp) {
      await sb.from('studio_otps').update({ attempts: newest.attempts + 1 }).eq('id', newest.id);
      return jsonResponse({ ok: false, error: 'Code is incorrect.' }, 400);
    }

    // Mark just the matching OTP used. Other unexpired codes stay valid
    // until their own TTL elapses — harmless since each is single-use and
    // both throttle and attempt caps still apply.
    await sb.from('studio_otps').update({ used_at: new Date().toISOString() }).eq('id', otp.id);

    // Generic mode: return whatever drafts exist for this email so the caller
    // can either route to the right plan+region URL or prompt a plan picker.
    if (generic) {
      const { data: drafts } = await sb
        .from('submissions')
        .select('id, plan, region, status, last_step_completed, last_saved_at, studio_name')
        .ilike('contact_email', normEmail)
        .order('last_saved_at', { ascending: false, nullsFirst: false });
      const verified = randomToken(16);
      // Stash a short-lived verified-email marker so the caller can claim a
      // session for a chosen plan+region without re-OTP. We re-use the
      // studio_otps table by inserting a marker row used as a one-time bridge.
      const expires = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const verifiedHash = await sha256Hex(verified);
      await sb.from('studio_otps').insert({
        email: normEmail,
        code_hash: 'verified:' + verifiedHash,
        expires_at: expires,
        used_at: null,
      });
      return jsonResponse({
        ok: true,
        generic: true,
        verified_token: verified,
        verified_expires_at: expires,
        drafts: drafts || [],
      });
    }

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
