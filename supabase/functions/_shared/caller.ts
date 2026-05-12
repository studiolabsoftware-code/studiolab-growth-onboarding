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
