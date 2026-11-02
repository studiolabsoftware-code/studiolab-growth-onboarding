import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { canonicalString, signS2s, verifyS2s, type S2sInput } from './s2s-auth.ts';

const SECRET = 'a'.repeat(40);
const NOW = 1_800_000_000;
const NONCE = 'f'.repeat(32);

async function good(over: Partial<S2sInput> = {}): Promise<S2sInput> {
  const seen = new Set<string>();
  const base = { direction: 'dashboard-to-onboarding' as const, method: 'POST', path: '/dashboard-onboarding', body: '{"op":"setup.read"}', timestamp: String(NOW), nonce: NONCE };
  const signature = await signS2s(SECRET, await canonicalString(base.direction, base.method, base.path, base.timestamp, base.nonce, base.body));
  return { ...base, signature, secrets: [SECRET], nowSeconds: NOW, claimNonce: (n) => { if (seen.has(n)) return Promise.resolve(false); seen.add(n); return Promise.resolve(true); }, ...over };
}

Deno.test('a genuine request passes, and the same request again is a replay', async () => {
  const i = await good();
  assertEquals(await verifyS2s(i), null);
  assertEquals(await verifyS2s(i), 'replay');
});
Deno.test('a change to the body, path, method, timestamp or nonce breaks the signature', async () => {
  for (const over of [{ body: '{"op":"setup.ensure"}' }, { path: '/other' }, { method: 'GET' }, { timestamp: String(NOW + 1) }, { nonce: 'e'.repeat(32) }]) {
    assertEquals(await verifyS2s({ ...(await good()), ...over }), 'bad_signature');
  }
});
Deno.test('a signature from the wrong secret is refused, and a rotation accepts the previous one', async () => {
  const i = await good();
  assertEquals(await verifyS2s({ ...i, secrets: ['b'.repeat(40)] }), 'bad_signature');
  assertEquals(await verifyS2s({ ...i, secrets: ['b'.repeat(40), SECRET] }), null);
});
Deno.test('a bad signature never records the nonce', async () => {
  let claimed = 0;
  const i = await good({ claimNonce: () => { claimed++; return Promise.resolve(true); } });
  await verifyS2s({ ...i, signature: '0'.repeat(64) });
  assertEquals(claimed, 0);
});
Deno.test('too old and too new are stale; the edge of the window is not', async () => {
  const i = await good();
  assertEquals(await verifyS2s({ ...i, nowSeconds: NOW + 301 }), 'stale');
  assertEquals(await verifyS2s({ ...i, nowSeconds: NOW - 301 }), 'stale');
  assertEquals(await verifyS2s({ ...i, nowSeconds: NOW + 300 }), null);
});
Deno.test('no secret, or a short one, refuses everything', async () => {
  const i = await good();
  for (const secrets of [[], [undefined], ['short']]) assertEquals(await verifyS2s({ ...i, secrets }), 'not_configured');
});
Deno.test('malformed headers are refused before any crypto', async () => {
  const i = await good();
  for (const over of [{ timestamp: null }, { timestamp: 'soon' }, { nonce: 'short' }, { signature: 'zz' }, { signature: null }]) {
    assertEquals(await verifyS2s({ ...i, ...over }), 'malformed');
  }
});
