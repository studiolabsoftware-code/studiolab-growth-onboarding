// Verifies a 6-digit OTP for an email. On success: finds or creates the draft
// submission for (email, plan, region), issues a 90-day session token, returns
// the draft data so the form can hydrate.

//
// PRE-BIND PATH. When the caller passes the invite link's `?t=` token as `t`, the server re-resolves
// it (it does NOT trust anything send-otp said) and uses the result for three things: the address the
// OTP was checked against, the plan and region the draft is keyed on, and the location_id stamped on
// the row. All three are server-derived, because all three are forgeable from a browser and the
// binding key in particular is what promote_verified_capture() later depends on.
//
// Seeding NEVER clobbers. A studio who has already typed something keeps it; only empty fields are
// filled. Coming back to a half-finished draft must never rewrite it.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, growthClient, sha256Hex, randomToken } from '../_shared/supabase.ts';
import { resolvePrebind, buildSeed, type PrebindIdentity, type PrebindRow } from '../_shared/prebind.ts';

// Long-lived studio session. Onboarding payloads are not sensitive (studio
// name, classes, public KB content) and we want studios to be able to come
// back to a half-finished draft weeks later without re-verifying.
const SESSION_TTL_HOURS = 24 * 90;
const MAX_ATTEMPTS = 5;
const ALLOWED_PLANS  = new Set(['launch', 'scale', 'ai']);
const ALLOWED_REGIONS = new Set(['AU', 'US']);

// LIKE-METACHARACTER SAFETY (fixed 2026-08-20). These lookups used .ilike() on a client-supplied
// address. `%` and `_` are LIKE wildcards and the email validator accepted both, so a caller could
// post `%@%.%`, match every row at once, and use a code minted for their OWN address to pass a check
// against somebody else's. Storage is already lower-cased by our own write paths (verified against
// production: zero mixed-case rows in submissions, studio_otps or admin_users), so .eq() is exactly
// equivalent for real data and removes the wildcard entirely.

function isValidEmail(v: string): boolean {
  // `%`, `*` and `\\` are never legitimate in an address and are all LIKE/PostgREST metacharacters.
  // Defence in depth behind the .eq() lookups below.
  if (/[%*\\]/.test(String(v))) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const { email, code, plan, region, t: prebindToken } = await req.json();
    if (!code || !/^\d{6}$/.test(String(code))) return jsonResponse({ ok: false, error: 'Code must be 6 digits.' }, 400);

    // Re-resolve the token here rather than trusting send-otp's earlier answer. These two calls are
    // separate anonymous requests; nothing carries state between them that a client could not forge.
    let prebound: PrebindIdentity | null = null;
    if (prebindToken !== undefined && prebindToken !== null && prebindToken !== '') {
      prebound = await resolvePrebind(prebindToken, async (rawToken) => {
        const { data, error } = await growthClient()
          .rpc('resolve_signup_by_token', { p_raw_token: rawToken });
        // Log HERE, before resolvePrebind's catch swallows it. The RPC raises loudly on a missing
        // PREBIND_TOKEN_PEPPER precisely so a deployment fault is not mistaken for a bad link - and
        // without this line that raise is discarded three layers up and 100% of studios are told
        // their link is invalid with nothing in the logs. The raw token is not in the error string,
        // so this leaks nothing, and the response the caller sees is unchanged.
        if (error) {
          console.error('prebind rpc failed:', error.code ?? 'no-code', error.message ?? 'no-message');
          throw error;
        }
        return data as PrebindRow[] | null;
      });
      if (!prebound) {
        return jsonResponse({
          ok: false,
          error: 'That setup link is no longer valid. Enter your email address to get a code.',
          prebind_failed: true,
        }, 400);
      }
    }

    if (!prebound && (!email || !isValidEmail(email))) {
      return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
    }

    // The token wins over the URL. Without this a studio could edit /au/launch to /au/ai and key a
    // draft to a plan they are not on.
    //
    // If the token resolves but its stored plan/region do NOT map to a form route, we fail closed
    // rather than falling back to the URL. Falling back would hand plan selection straight back to
    // the browser on the one path that is supposed to be authoritative, and plan drives the setup
    // fee. This cannot happen for a real invite - signup-webhook-receiver HOLDS rather than emailing
    // a link it cannot route - so reaching here means the signup record is genuinely odd and a human
    // should look at it.
    if (prebound && (!prebound.plan || !prebound.region)) {
      console.error('prebind: unroutable plan/region on signup', {
        location_id: prebound.locationId, plan_unmapped: !prebound.plan, region_unmapped: !prebound.region,
      });
      return jsonResponse({
        ok: false,
        error: 'We could not match your account to a setup form. Please email info@studiolabsoftware.com and we will sort it out.',
        plan_unresolved: true,
      }, 409);
    }
    // NOTE: that 409 is also what makes the generic branch below unreachable on the token path - a
    // resolved token always yields a mapped plan AND region by the time we get past here. If this
    // rule is ever relaxed, the generic branch will need the verified address returned to it, because
    // the browser never learns it on this path and claim-draft requires one.
    const effPlan = prebound?.plan ?? plan;
    const effRegion = prebound?.region ?? region;

    // Generic mode: caller does not yet know plan + region. We verify the OTP,
    // then either look up an existing draft for this email (if any) and return
    // it so the caller can route, or signal that a plan picker is needed.
    const generic = !effPlan && !effRegion;
    if (!generic) {
      if (!ALLOWED_PLANS.has(effPlan)) return jsonResponse({ ok: false, error: 'Unknown plan.' }, 400);
      if (!ALLOWED_REGIONS.has(effRegion)) return jsonResponse({ ok: false, error: 'Unknown region.' }, 400);
    }

    const normEmail = prebound ? prebound.contactEmail : String(email).trim().toLowerCase();
    const sb = adminClient();

    // Match the code against any unused unexpired row for this email.
    // Multiple codes can coexist in the studio's inbox when delivery is slow
    // or they hit resend; the first one they paste should work.
    const { data: otpRows } = await sb
      .from('studio_otps')
      .select('*')
      .eq('email', normEmail)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(10);
    const rows = otpRows || [];
    if (!rows.length) return jsonResponse({ ok: false, error: 'No active code. Request a new one.' }, 400);
    const newest = rows[0];
    // Count attempts across EVERY live code for this address, not just the newest. A guess is tested
    // against all of them (rows.find below), and a resend mints a fresh row whose attempts start at
    // zero - so capping on `newest` alone let the budget reset every 60 seconds while each guess kept
    // being checked against up to ten codes at once.
    const totalAttempts = rows.reduce((sum, r) => sum + (Number(r.attempts) || 0), 0);
    if (newest.attempts >= MAX_ATTEMPTS || totalAttempts >= MAX_ATTEMPTS * 2) {
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
        .eq('contact_email', normEmail)
        .order('last_saved_at', { ascending: false, nullsFirst: false })
        .limit(20);
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

    // Find the draft. On the pre-bind path location_id is the CANONICAL key, so look there first.
    // Keying only on (email, plan, region) collapses two sub-accounts that share an owner address
    // onto one row: the first token stamps location A, the second no-ops, and the owner then fills in
    // studio B's details on a submission bound to studio A. That binding is what the Connector reads
    // to match a submission to a sub-account, so the mistake outlives onboarding.
    let existing: Record<string, unknown> | null = null;
    if (prebound) {
      const { data: byLocation } = await sb
        .from('submissions')
        .select('*')
        .eq('location_id', prebound.locationId)
        .order('last_saved_at', { ascending: false, nullsFirst: false })
        .limit(1);
      existing = (byLocation && byLocation[0]) || null;
    }
    if (!existing) {
      const { data: byEmail } = await sb
        .from('submissions')
        .select('*')
        .eq('contact_email', normEmail)
        .eq('plan', effPlan)
        .eq('region', effRegion)
        .maybeSingle();
      existing = byEmail || null;
    }

    // A draft already bound to a DIFFERENT sub-account is a real conflict, not a no-op. buildSeed
    // deliberately will not re-point it, but silence is how the wrong binding survives: make it
    // visible in the logs and in the response instead of leaving it "for a human to notice" when no
    // human is looking.
    let locationConflict = false;
    if (prebound && existing && existing.location_id && existing.location_id !== prebound.locationId) {
      locationConflict = true;
      console.error('prebind: draft already bound to a different sub-account', {
        submission_id: existing.id,
        bound_location_id: existing.location_id,
        token_location_id: prebound.locationId,
      });
    }

    const sessionTokenRaw = randomToken(32);
    const sessionTokenHash = await sha256Hex(sessionTokenRaw);
    const sessionExpires = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

    // Tier-1 identity seed lives in _shared/prebind.ts (buildSeed) so its no-clobber rule is unit
    // tested rather than asserted in a comment.
    const seedFor = (row: Record<string, unknown> | null) => buildSeed(prebound, row);

    let submission;
    if (existing) {
      const { data: updated, error } = await sb.from('submissions')
        .update({
          session_token_hash: sessionTokenHash,
          session_expires_at: sessionExpires,
          verified_at: existing.verified_at || new Date().toISOString(),
          last_saved_at: new Date().toISOString(),
          ...seedFor(existing),
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
          plan: effPlan,
          region: effRegion,
          status: 'draft',
          verified_at: new Date().toISOString(),
          last_saved_at: new Date().toISOString(),
          session_token_hash: sessionTokenHash,
          session_expires_at: sessionExpires,
          ...seedFor(null),
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
      ...(prebound ? { prebound: true } : {}),
      ...(locationConflict ? { location_conflict: true } : {}),
    });
  } catch (err) {
    // Never interpolate the request body here: it may carry a raw pre-bind token.
    console.error('verify-otp error:', err);
    // Never return the raw error: mailgun.ts throws with the API response body, which echoes the
    // recipient address on several 400s, and Postgres/env errors leak internals to an anon caller.
    return jsonResponse({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
  }
});
