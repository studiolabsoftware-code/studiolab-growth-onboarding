// Shared caller-identity helper. Verifies the bearer JWT on the incoming
// request via the Supabase auth API, then looks up the matching row in
// admin_users using the service-role client. Returns null when the caller
// is unknown, inactive, or has no valid session.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { adminClient } from './supabase.ts';

export type CallerProfile = {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'va';
  is_active: boolean;
};

// Verify a bearer token represents the Supabase service role. Two paths,
// either is sufficient — both REQUIRE cryptographic verification, never a
// blind role-claim decode:
//
//   1. Exact match against the auto-injected SUPABASE_SERVICE_ROLE_KEY env
//      var. Constant-time-ish via length+equality; safe because the env var
//      is server-side only.
//
//   2. HS256 signature verification against SUPABASE_JWT_SECRET. The token
//      MUST carry a valid HS256 signature signed by Supabase's project JWT
//      secret AND have role='service_role' in the payload. This handles the
//      case where Supabase rotated the auto-injected env var so it no longer
//      byte-matches the legacy JWT we stored in Vault for pg_cron — but
//      still requires the token to be signed by us, not just claim our role.
//
// A previous version of this function accepted any unverified JWT whose
// `role` claim was 'service_role'. That was a hard auth bypass (forge a JWT
// on jwt.io → service-role on every endpoint). Do not regress.
export async function isServiceRoleCaller(req: Request): Promise<boolean> {
  const authz = req.headers.get('Authorization') || '';
  const token = authz.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  // Path 1: exact env match.
  const envServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (envServiceRole && token === envServiceRole) return true;

  // Path 2: signature-verified JWT with role='service_role' claim. Returns
  // false for any token whose signature doesn't validate against the project
  // JWT secret, even if the claim is correctly shaped.
  const jwtSecret = Deno.env.get('SUPABASE_JWT_SECRET') || '';
  if (!jwtSecret) return false;
  return await verifyHs256ServiceRole(token, jwtSecret);
}

async function verifyHs256ServiceRole(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, sigB64] = parts;

    // Header must declare HS256. Anything else is rejected outright — alg=none
    // attacks are a well-known JWT pitfall and we don't support RS256 here.
    const header = JSON.parse(base64UrlDecode(headerB64));
    if (!header || header.alg !== 'HS256' || header.typ !== 'JWT') return false;

    // Verify signature over header.payload using HMAC-SHA256 + the project secret.
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const signed = enc.encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlToBytes(sigB64);
    const valid = await crypto.subtle.verify('HMAC', key, signature, signed);
    if (!valid) return false;

    // Signature is good. Now require role='service_role' AND a non-expired exp.
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (!payload || payload.role !== 'service_role') return false;
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

function base64UrlDecode(s: string): string {
  return atob(toStandardBase64(s));
}

// Returns Uint8Array<ArrayBuffer>, not a bare Uint8Array: `new Uint8Array(len)` below allocates its
// own ArrayBuffer, but the wider annotation resolved to Uint8Array<ArrayBufferLike>, which is not a
// BufferSource, which is why crypto.subtle.verify above would not type-check. Tightening the return
// type is the accurate fix; casting at the call site would have hidden a real signature-verification
// path behind an assertion.
function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = toStandardBase64(s);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toStandardBase64(s: string): string {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = padded.length % 4;
  return padded + (padLen ? '='.repeat(4 - padLen) : '');
}

export async function getCallerProfile(req: Request): Promise<CallerProfile | null> {
  const authz = req.headers.get('Authorization') || '';
  const token = authz.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return null;

  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData?.user?.email) return null;

  const email = String(userData.user.email).toLowerCase();
  const sb = adminClient();
  // LIKE-METACHARACTER SAFETY (2026-08-21). This used .ilike() on the address from a verified JWT.
  // `%` and `_` are LIKE wildcards and `%` is a legal email local-part character (RFC 5321), so an
  // account whose own verified address contained one could match a DIFFERENT admin row and inherit
  // that person's role. Narrow, but free to close. Production has zero mixed-case admin_users rows
  // and `email` is already lower-cased above, so .eq() is equivalent for real data. Same defect
  // class as the send-otp / verify-otp fix a day earlier; this pass swept what that one did not.
  const { data: row } = await sb.from('admin_users')
    .select('id, email, name, role, is_active')
    .eq('email', email)
    .maybeSingle();
  if (!row || !row.is_active) return null;
  return row as CallerProfile;
}
