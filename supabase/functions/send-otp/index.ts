// Generates a 6-digit OTP, stores it hashed, and emails it to the studio.
// Anon-callable. Rate-limited to one code per email per 60 seconds.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { verificationCode } from '../_shared/email-templates.ts';

const OTP_TTL_MIN = 10;
const RESEND_THROTTLE_SEC = 60;

function sixDigitCode(): string {
  // Cryptographically random 6-digit code (000000-999999, leading-zero padded)
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

function isValidEmail(v: string): boolean {
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
    const { email } = await req.json();
    if (!email || !isValidEmail(email)) {
      return jsonResponse({ ok: false, error: 'Invalid email address.' }, 400);
    }
    const normEmail = String(email).trim().toLowerCase();

    const sb = adminClient();

    // Throttle: check most recent OTP for this email
    const { data: recent } = await sb
      .from('studio_otps')
      .select('created_at')
      .ilike('email', normEmail)
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

    const { error: insErr } = await sb.from('studio_otps').insert({
      email: normEmail, code_hash, expires_at,
    });
    if (insErr) throw insErr;

    const t = otpEmail(code);
    await sendEmail({ to: normEmail, subject: t.subject, html: t.html, text: t.text });

    return jsonResponse({ ok: true, expires_in_seconds: OTP_TTL_MIN * 60 });
  } catch (err) {
    console.error('send-otp error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
