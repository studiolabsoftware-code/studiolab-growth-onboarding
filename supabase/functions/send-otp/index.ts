// Generates a 6-digit OTP, stores it hashed, and emails it to the studio.
// Anon-callable. Rate-limited to one code per email per 60 seconds.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/mailgun.ts';

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

const LOGO_URL = 'https://app.studiolabgrowth.com/assets/growth-logo-email.png';

function otpEmail(code: string) {
  const subject = `Your StudioLAB Growth code: ${code}`;
  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background:#F2F3F7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; color:#13102E;">
  <div style="max-width:480px; margin:0 auto; padding:32px 20px;">
    <div style="background:#13102E; padding:22px 24px; border-radius:12px 12px 0 0; text-align:left;">
      <img src="${LOGO_URL}" alt="StudioLAB Growth" width="127" height="30" style="display:block;height:30px;width:auto;border:0;">
    </div>
    <div style="background:#fff; border:1px solid #DFE0EC; border-top:none; border-radius:0 0 12px 12px; padding:28px 24px;">
      <h1 style="margin:0 0 12px; font-size:18px; font-weight:700;">Your verification code</h1>
      <p style="margin:0 0 20px; font-size:14px; color:#4A4C65; line-height:1.55;">Enter this code on your setup form to continue. The code expires in ${OTP_TTL_MIN} minutes.</p>
      <div style="background:#F2F3F7; border:1px solid #DFE0EC; border-radius:10px; padding:18px; text-align:center; font-size:30px; font-weight:800; letter-spacing:8px; color:#E8197F;">${code}</div>
      <p style="margin:24px 0 0; font-size:12px; color:#9B9DB8; line-height:1.5;">If you did not request this code, you can ignore this email. Your account stays safe.</p>
    </div>
    <p style="margin:18px 0 0; text-align:center; font-size:11px; color:#9B9DB8;">StudioLAB Growth · growth@studiolabgrowth.com</p>
  </div>
</body></html>`;
  const text = `Your StudioLAB Growth verification code is ${code}. It expires in ${OTP_TTL_MIN} minutes.`;
  return { subject, html, text };
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
