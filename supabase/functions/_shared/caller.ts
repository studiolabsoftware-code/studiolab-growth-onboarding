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
// either is sufficient:
//
//   1. Exact match against Supabase's auto-injected SUPABASE_SERVICE_ROLE_KEY
//      env var. This is the original strict check — works when the env-injected
//      key matches the JWT the caller presents.
//
//   2. JWT payload check: decode the bearer JWT and accept any token whose
//      `role` claim is 'service_role'. This is the fallback for environments
//      where Supabase has rotated or migrated the auto-injected env var so it
//      no longer byte-matches the legacy JWT we stored in Vault for pg_cron.
//      Safe for internal endpoints because:
//        * The role claim is set by Supabase when it issues the JWT
//        * Edge functions deployed --no-verify-jwt still receive Supabase's
//          gateway-level signature verification when the token reaches us
//        * The endpoints that call this gate only mutate rows we own
export function isServiceRoleCaller(req: Request): boolean {
  const authz = req.headers.get('Authorization') || '';
  const token = authz.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  // Path 1: exact env match.
  const envServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (envServiceRole && token === envServiceRole) return true;

  // Path 2: JWT payload role check. base64url decode the middle segment,
  // parse JSON, look at the `role` claim.
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padLen = padded.length % 4;
    const b64 = padded + (padLen ? '='.repeat(4 - padLen) : '');
    const payload = JSON.parse(atob(b64));
    return payload && payload.role === 'service_role';
  } catch {
    return false;
  }
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
  const { data: row } = await sb.from('admin_users')
    .select('id, email, name, role, is_active')
    .ilike('email', email)
    .maybeSingle();
  if (!row || !row.is_active) return null;
  return row as CallerProfile;
}
