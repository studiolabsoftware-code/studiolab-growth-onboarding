// Run: deno test --allow-read supabase/functions/_shared/cron-auth.test.ts
//
// This guards the auth path that pg_cron uses to reach `stripe-webhook-health`,
// the check that exists because a deleted Stripe webhook went unnoticed for 15
// days and a real studio paid AUD 768.90 for nothing. A monitor that cannot
// authenticate is a monitor that does not run, so these are not academic.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { bearerToken, constantTimeEquals, isCronCaller } from './cron-auth.ts';

const SECRET = 'a'.repeat(64);

function reqWith(authz: string | null): Request {
  const headers = new Headers();
  if (authz !== null) headers.set('Authorization', authz);
  return new Request('https://example.test/', { method: 'POST', headers });
}

Deno.test('accepts the exact secret as a bearer token', () => {
  assert(isCronCaller(reqWith(`Bearer ${SECRET}`), SECRET));
});

Deno.test('bearer prefix is case-insensitive and tolerates padding', () => {
  assert(isCronCaller(reqWith(`bearer   ${SECRET}  `), SECRET));
});

Deno.test('rejects a wrong secret of identical length', () => {
  assertFalse(isCronCaller(reqWith(`Bearer ${'b'.repeat(64)}`), SECRET));
});

Deno.test('rejects a correct prefix that is truncated', () => {
  assertFalse(isCronCaller(reqWith(`Bearer ${'a'.repeat(63)}`), SECRET));
});

// The bug this module exists to make impossible. With CRON_SECRET unset, a
// naive constant-time compare sees ''==='' and returns true, which would make
// every cron endpoint anonymously callable.
Deno.test('unset CRON_SECRET rejects everything, including an empty bearer', () => {
  assertFalse(isCronCaller(reqWith('Bearer '), ''));
  assertFalse(isCronCaller(reqWith(''), ''));
  assertFalse(isCronCaller(reqWith(null), ''));
  assertFalse(isCronCaller(reqWith(`Bearer ${SECRET}`), ''));
});

Deno.test('missing or empty Authorization header is rejected', () => {
  assertFalse(isCronCaller(reqWith(null), SECRET));
  assertFalse(isCronCaller(reqWith(''), SECRET));
});

// Deliberate, and identical to `nudge-abandoned-onboarding` and `ops-reminders`,
// which both do `authz.replace(/^Bearer\s+/i, '').trim() === expected`. The
// prefix is optional there, so it is optional here: the full secret is still
// required either way, so nothing is weakened, and diverging would mean the same
// token authenticates against two cron endpoints but not the third.
Deno.test('a bare token without the Bearer prefix is accepted, as elsewhere', () => {
  assert(isCronCaller(reqWith(SECRET), SECRET));
  assertFalse(isCronCaller(reqWith('b'.repeat(64)), SECRET));
});

Deno.test('constantTimeEquals matches === semantics for equality', () => {
  assert(constantTimeEquals('abc', 'abc'));
  assertFalse(constantTimeEquals('abc', 'abd'));
  assertFalse(constantTimeEquals('abc', 'abcd'));
  assertFalse(constantTimeEquals('', 'a'));
  assert(constantTimeEquals('', '')); // caller must guard emptiness, not this primitive
});

Deno.test('constantTimeEquals is byte-safe for multi-byte input', () => {
  assert(constantTimeEquals('café', 'café'));
  assertFalse(constantTimeEquals('café', 'cafe'));
});

Deno.test('bearerToken extracts the token', () => {
  assertEquals(bearerToken('Bearer xyz'), 'xyz');
  assertEquals(bearerToken('  Bearer   xyz  '.trim()), 'xyz');
  assertEquals(bearerToken(null), '');
});
