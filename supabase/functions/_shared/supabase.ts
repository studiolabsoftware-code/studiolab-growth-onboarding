import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export function adminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.');
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Service-role client scoped to the `growth_manager` schema, which the Growth Connector owns.
 *
 * The onboarding platform and the Connector share ONE Supabase project, so the pre-bind resolve RPC
 * is reachable from here. It is a separate client because supabase-js pins the schema per client and
 * everything else in this repo talks to `public`.
 */
export function growthClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.');
  return createClient(url, key, { db: { schema: 'growth_manager' }, auth: { persistSession: false } });
}

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}
