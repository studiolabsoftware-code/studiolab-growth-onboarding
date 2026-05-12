// Verifies a 6-digit OTP for an admin email and mints a Supabase Auth session
// without ever sending a magic link. The studio OTP infrastructure (send-otp,
// studio_otps table) is reused; this function adds the admin allowlist check
// and the session-mint step.
//
// Flow:
//   1. Studio types email on /admin → send-otp fires (existing function)
//   2. Studio types code → this function runs:
//      a. Confirms the email is on admin_users with is_active=true
//      b. Validates the OTP via studio_otps (same as studio path)
//      c. Generates a one-shot magic-link server-side, extracts the hashed
//         token from the action_link URL, never sending it via email
//      d. Calls verifyOtp on that token to produce a real Supabase Auth
//         session, returning access_token + refresh_token
//   3. Client calls supabase.auth.setSession({ access_token, refresh_token })
//      so all subsequent queries run with the authenticated role and the
//      existing RLS policies on submissions, change_requests, etc. just work.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';

const MAX_ATTEMPTS = 5;

function isValidEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const { email, code } = await req.json();
    if (!email || !isValidEmail(email)) return jsonResponse({ ok: false, error: 'Invalid email.' }, 400);
    if (!code || !/^\d{6}$/.test(String(code))) return jsonResponse({ ok: false, error: 'Code must be 6 digits.' }, 400);

    const normEmail = String(email).trim().toLowerCase();
    const sb = adminClient();

    // 1. Allowlist check
    const { data: adminRow } = await sb.from('admin_users')
      .select('id, email, role, name')
      .ilike('email', normEmail)
      .eq('is_active', true)
      .maybeSingle();
    if (!adminRow) {
      return jsonResponse({ ok: false, error: 'This email is not authorised as an admin.' }, 403);
    }

    // 2. Validate OTP via the shared studio_otps table. Take the newest
    // unused, unexpired row if more than one exists (defensive — send-otp now
    // invalidates prior codes, but legacy rows may still be around).
    const { data: otpRows } = await sb.from('studio_otps')
      .select('*')
      .ilike('email', normEmail)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    const otp = (otpRows && otpRows[0]) || null;
    if (!otp) return jsonResponse({ ok: false, error: 'No active code. Request a new one.' }, 400);
    if (otp.attempts >= MAX_ATTEMPTS) {
      return jsonResponse({ ok: false, error: 'Too many attempts. Request a new code.' }, 429);
    }

    const incomingHash = await sha256Hex(String(code));
    if (incomingHash !== otp.code_hash) {
      await sb.from('studio_otps').update({ attempts: otp.attempts + 1 }).eq('id', otp.id);
      return jsonResponse({ ok: false, error: 'Code is incorrect.' }, 400);
    }
    await sb.from('studio_otps').update({ used_at: new Date().toISOString() }).eq('id', otp.id);

    // 3. Mint a real Supabase Auth session for this admin email.
    //    generateLink with type='magiclink' returns an action_link whose
    //    `token` query param is the hashed magiclink token. We verify it
    //    server-side immediately so no email is ever sent and the studio
    //    sees no magic link.
    // deno-lint-ignore no-explicit-any
    const { data: linkData, error: linkErr } = await (sb.auth as any).admin.generateLink({
      type: 'magiclink',
      email: normEmail,
    });
    if (linkErr || !linkData) throw new Error('generateLink failed: ' + (linkErr?.message || 'no data'));

    const properties = linkData.properties || linkData;
    let tokenHash: string | null = null;
    if (properties.hashed_token) tokenHash = properties.hashed_token;
    else if (properties.action_link) {
      try {
        const u = new URL(properties.action_link);
        tokenHash = u.searchParams.get('token');
      } catch (_) { /* fallthrough */ }
    }
    if (!tokenHash) throw new Error('Could not extract token from generateLink output.');

    const { data: verifyData, error: verifyErr } = await sb.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'magiclink',
    });
    if (verifyErr || !verifyData || !verifyData.session) {
      throw new Error('verifyOtp failed: ' + (verifyErr?.message || 'no session'));
    }

    // Stamp last_login_at so the admin user list can show who is active. Best
    // effort — never block sign-in on this.
    sb.from('admin_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', adminRow.id)
      .then(({ error }) => { if (error) console.warn('last_login_at update failed:', error); });

    return jsonResponse({
      ok: true,
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
      expires_in: verifyData.session.expires_in,
      admin: { email: adminRow.email, name: adminRow.name, role: adminRow.role },
    });
  } catch (err) {
    console.error('verify-admin-otp error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
