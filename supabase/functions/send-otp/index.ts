// Generates a 6-digit OTP, stores it hashed, and emails it to the studio.
// Anon-callable. Rate-limited to one code per email per 60 seconds.
//
// PRE-BIND PATH. A studio arriving from a StudioLAB Growth invite link carries `?t=<token>`. When the
// caller passes that token as `t`, we resolve the address SERVER-SIDE and mail the code there, so the
// studio never types an email we already know. The client-supplied `email` is IGNORED entirely on
// this path: honouring it would let anyone holding a link redirect a studio's code to their own
// inbox. The response carries only a MASKED hint, never the resolved address.
//
// The token itself never unlocks data here. It is a bearer credential sitting in an inbox, so the
// worst case for a forwarded link is that a code is mailed to the legitimate studio's own address.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, growthClient, sha256Hex } from '../_shared/supabase.ts';
import { resolvePrebind, type PrebindRow } from '../_shared/prebind.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { verificationCode } from '../_shared/email-templates.ts';

const OTP_TTL_MIN = 10;
const RESEND_THROTTLE_SEC = 60;

// LIKE-METACHARACTER SAFETY (fixed 2026-08-20). These lookups used .ilike() on a client-supplied
// address. `%` and `_` are LIKE wildcards and the email validator accepted both, so a caller could
// post `%@%.%`, match every row at once, and use a code minted for their OWN address to pass a check
// against somebody else's. Storage is already lower-cased by our own write paths (verified against
// production: zero mixed-case rows in submissions, studio_otps or admin_users), so .eq() is exactly
// equivalent for real data and removes the wildcard entirely.

function sixDigitCode(): string {
  // Cryptographically random 6-digit code (000000-999999, leading-zero padded)
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

function isValidEmail(v: string): boolean {
  // `%`, `*` and `\\` are never legitimate in an address and are all LIKE/PostgREST metacharacters.
  // Defence in depth behind the .eq() lookups below.
  if (/[%*\\]/.test(String(v))) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function otpEmail(code: string) {
  const t = verificationCode({ code, expiresInMinutes: OTP_TTL_MIN });
  const text = `Your StudioLAB Growth verification code is ${code}. It expires in ${OTP_TTL_MIN} minutes.`;
  return { subject: t.subject, html: t.html, text };
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const { email, t: prebindToken } = await req.json();

    // Resolve the pre-bind token first, when one was sent. Its address wins over anything the client
    // supplied. A token that does not resolve is reported as a dead link rather than silently falling
    // back to the client's email, because falling back is precisely the redirect we are preventing.
    let prebound = null;
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
    const normEmail = prebound ? prebound.contactEmail : String(email).trim().toLowerCase();

    const sb = adminClient();

    // Throttle: check most recent OTP for this email
    const { data: recent } = await sb
      .from('studio_otps')
      .select('created_at')
      .eq('email', normEmail)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent) {
      const ageSec = (Date.now() - new Date(recent.created_at).getTime()) / 1000;
      if (ageSec < RESEND_THROTTLE_SEC) {
        const wait = Math.ceil(RESEND_THROTTLE_SEC - ageSec);
        return jsonResponse({ ok: false, error: `Please wait ${wait}s before requesting another code.` }, 429);
      }
    }

    const code = sixDigitCode();
    const code_hash = await sha256Hex(code);
    const expires_at = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000).toISOString();

    // Prior unused codes within their TTL stay valid. Studios (and admins)
    // routinely have multiple codes in their inbox when delivery is slow or
    // they click resend. Verify accepts any of the unexpired hashes so the
    // first code that lands in their inbox always works.
    const { error: insErr } = await sb.from('studio_otps').insert({
      email: normEmail, code_hash, expires_at,
    });
    if (insErr) throw insErr;

    const t = otpEmail(code);
    await sendEmail({ to: normEmail, subject: t.subject, html: t.html, text: t.text });

    return jsonResponse({
      ok: true,
      expires_in_seconds: OTP_TTL_MIN * 60,
      // NO address, masked or otherwise. A masked hint still discloses the domain, which is usually
      // the studio's own brand, so it tells whoever holds a forwarded link exactly whose token it is.
      // BR1 says a forwarded link must disclose nothing, and the studio does not need the hint: the
      // invite arrived in that inbox, so they already know where to look.
      ...(prebound ? { prebound: true } : {}),
    });
  } catch (err) {
    // Never interpolate the request body here: it may carry a raw pre-bind token.
    console.error('send-otp error:', err);
    // Never return the raw error: mailgun.ts throws with the API response body, which echoes the
    // recipient address on several 400s, and Postgres/env errors leak internals to an anon caller.
    return jsonResponse({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
  }
});
