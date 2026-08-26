// Bearer auth for pg_cron-invoked functions.
//
// WHY THIS IS ITS OWN MODULE. `caller.ts` imports supabase-js from esm.sh, so
// anything living there cannot be imported under `deno test --allow-read`
// without network access. This logic is security-critical and must be tested,
// so it stays dependency-free and the entrypoints only wire it up.
//
// WHY IT EXISTS AT ALL. `stripe-webhook-health` originally accepted only
// `isServiceRoleCaller`, which meant pg_cron had to present the service-role
// key. The vault entry holding that key turned out to contain the literal
// string 'YOUR-SERVICE-ROLE-KEY' (see migration 050), so every job built on it
// had never once authenticated. The two cron jobs that DO work in production
// (`ops-reminders-daily`, `nudge-abandoned-onboarding-daily`) present
// CRON_SECRET instead: a dedicated, narrowly-scoped token rather than the
// highest-privilege key in the project. Standardising on it is both the proven
// path and the smaller blast radius if a cron command is ever read by someone
// who should not have it.

/** Extract the bare token from an `Authorization: Bearer <token>` header. */
export function bearerToken(authorizationHeader: string | null | undefined): string {
  return String(authorizationHeader || '').replace(/^Bearer\s+/i, '').trim();
}

/**
 * Constant-time string comparison.
 *
 * Length is compared first and therefore leaks, which is standard and
 * acceptable: the secret's length is not the secret. The byte loop below runs
 * over the full buffer regardless of where the first difference falls, so it
 * does not short-circuit the way `===` does.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

/**
 * Does this request carry the configured CRON_SECRET as its bearer token?
 *
 * FAILS CLOSED on an unset secret. That guard is not decorative: with
 * CRON_SECRET unset and no Authorization header, both sides of the comparison
 * are the empty string and a naive constant-time compare returns TRUE, which
 * would open every cron endpoint to anonymous callers. Both emptiness checks
 * below must stay.
 */
export function isCronCaller(
  req: Request,
  expectedSecret: string | undefined = Deno.env.get('CRON_SECRET') || '',
): boolean {
  const expected = String(expectedSecret || '');
  if (!expected) return false;
  const token = bearerToken(req.headers.get('Authorization'));
  if (!token) return false;
  return constantTimeEquals(token, expected);
}
