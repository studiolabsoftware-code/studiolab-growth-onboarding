// Run: deno test supabase/functions/_shared/prebind.test.ts
//
// This is auth-adjacent code on a public, anon-callable path, so every fail-closed branch is pinned
// here. No network, no database: the RPC is injected.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  isWellFormedToken,
  mapPlan,
  mapRegion,
  toIdentity,
  resolvePrebind,
  type PrebindRow,
} from './prebind.ts';

const HEX64 = 'a'.repeat(64);

const row = (over: Partial<PrebindRow> = {}): PrebindRow => ({
  location_id: 'loc_ABC123',
  contact_email: 'Sarah@YourStudio.com',
  contact_first_name: 'Sarah',
  contact_last_name: 'Johnson',
  company_name: 'Dance Academy Melbourne',
  plan: 'dominate-ai',
  region: 'Australia',
  tier: 'growth-dominate',
  ...over,
});

Deno.test('isWellFormedToken accepts what the receiver actually mints', () => {
  assert(isWellFormedToken(HEX64));
  assert(isWellFormedToken('A'.repeat(32)));
  assert(isWellFormedToken(`  ${HEX64}  `), 'surrounding whitespace is trimmed, not rejected');
});

Deno.test('isWellFormedToken rejects everything else, including near-misses', () => {
  for (const bad of [
    undefined, null, '', '   ', 123, {}, [],
    'z'.repeat(64),              // not hex
    'a'.repeat(31),              // too short
    'a'.repeat(129),             // too long
    `${HEX64}' or 1=1--`,        // injection-shaped
    `${HEX64}\n${HEX64}`,        // multi-line: must not pass on the strength of one good line
  ]) {
    assertEquals(isWellFormedToken(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

Deno.test('mapPlan mirrors the Connector alias table, including the AI tier spellings', () => {
  assertEquals(mapPlan('launch'), 'launch');
  assertEquals(mapPlan('Scale'), 'scale');
  for (const v of ['ai', 'dominate', 'dominateai', 'dominate-ai', 'dominate_ai', 'dominate ai', 'DOMINATE-AI']) {
    assertEquals(mapPlan(v), 'ai', `${v} should map to ai`);
  }
  for (const v of [null, undefined, '', 'enterprise', 'launch-plus']) {
    assertEquals(mapPlan(v), null);
  }
  // Padded values arrive: these come straight off a GHL webhook payload, not a controlled form.
  assertEquals(mapPlan('  dominate-ai  '), 'ai');
  assertEquals(mapPlan('\tlaunch\n'), 'launch');
});

Deno.test('mapRegion returns the UPPERCASE form the submissions table stores', () => {
  for (const v of ['au', 'AU', 'aus', 'Australia']) assertEquals(mapRegion(v), 'AU');
  for (const v of ['us', 'USA', 'america', 'United States']) assertEquals(mapRegion(v), 'US');
  for (const v of [null, undefined, '', 'NZ', 'europe']) assertEquals(mapRegion(v), null);
  assertEquals(mapRegion('  Australia '), 'AU');
  assertEquals(mapRegion(' us\n'), 'US');
});

Deno.test('toIdentity normalises the address and carries the tier-1 fields', () => {
  const id = toIdentity(row());
  assert(id);
  assertEquals(id.contactEmail, 'sarah@yourstudio.com', 'lower-cased for the submissions lookup');
  assertEquals(id.locationId, 'loc_ABC123');
  assertEquals(id.firstName, 'Sarah');
  assertEquals(id.companyName, 'Dance Academy Melbourne');
  assertEquals(id.plan, 'ai');
  assertEquals(id.region, 'AU');
});

Deno.test('toIdentity refuses a PARTIAL row rather than half-resolving it', () => {
  assertEquals(toIdentity(null), null);
  assertEquals(toIdentity(undefined), null);
  // location_id is the binding key the whole thread hangs on.
  assertEquals(toIdentity(row({ location_id: null })), null);
  assertEquals(toIdentity(row({ location_id: '   ' })), null);
  // Without an address there is nowhere to send the code.
  assertEquals(toIdentity(row({ contact_email: null })), null);
  assertEquals(toIdentity(row({ contact_email: '' })), null);
});

Deno.test('toIdentity keeps a usable row whose plan/region did not map, so nobody is stranded', () => {
  const id = toIdentity(row({ plan: 'something-new', region: 'Mars' }));
  assert(id);
  assertEquals(id.plan, null);
  assertEquals(id.region, null);
  assertEquals(id.contactEmail, 'sarah@yourstudio.com', 'identity still resolves');
});

Deno.test('toIdentity blanks empty-string names rather than storing ""', () => {
  const id = toIdentity(row({ contact_first_name: '  ', company_name: '' }));
  assert(id);
  assertEquals(id.firstName, null);
  assertEquals(id.companyName, null);
});

Deno.test('resolvePrebind never calls the database for a malformed token', async () => {
  let calls = 0;
  const spy = async () => { calls++; return [row()]; };
  assertEquals(await resolvePrebind('not-a-token', spy), null);
  assertEquals(await resolvePrebind(undefined, spy), null);
  assertEquals(await resolvePrebind('', spy), null);
  assertEquals(calls, 0);
});

Deno.test('resolvePrebind handles both an array result and a single row', async () => {
  const fromArray = await resolvePrebind(HEX64, async () => [row()]);
  const fromSingle = await resolvePrebind(HEX64, async () => row());
  assertEquals(fromArray?.locationId, 'loc_ABC123');
  assertEquals(fromSingle?.locationId, 'loc_ABC123');
});

Deno.test('resolvePrebind fails CLOSED and INDISTINGUISHABLY on every failure mode', async () => {
  // An unknown token, an empty result, a null result, and a thrown RPC must be one outcome, so the
  // endpoint cannot be used as an oracle to tell a real token from a fake one.
  assertEquals(await resolvePrebind(HEX64, async () => []), null);
  assertEquals(await resolvePrebind(HEX64, async () => null), null);
  assertEquals(await resolvePrebind(HEX64, async () => { throw new Error('db down'); }), null);
  assertEquals(await resolvePrebind(HEX64, async () => [row({ location_id: null })]), null);
});

Deno.test('resolvePrebind passes the TRIMMED token through, never the raw padded string', async () => {
  let seen = '';
  await resolvePrebind(`  ${HEX64}  `, async (t) => { seen = t; return [row()]; });
  assertEquals(seen, HEX64);
});

// --- buildSeed: the no-clobber rule ------------------------------------------------------------
import { buildSeed } from './prebind.ts';

const identity = () => toIdentity(row())!;

Deno.test('buildSeed fills everything on a brand new draft', () => {
  assertEquals(buildSeed(identity(), null), {
    studio_name: 'Dance Academy Melbourne',
    first_name: 'Sarah',
    last_name: 'Johnson',
    location_id: 'loc_ABC123',
  });
});

Deno.test('buildSeed NEVER overwrites what the studio already typed', () => {
  const existing = {
    studio_name: 'The Name They Actually Want',
    first_name: 'Sarah-Jane',
    last_name: 'Smith-Johnson',
    location_id: 'loc_ALREADY_BOUND',
  };
  assertEquals(buildSeed(identity(), existing), {}, 'a fully-filled row must produce no write at all');
});

Deno.test('buildSeed fills only the gaps on a partly-filled draft', () => {
  const partial = { studio_name: 'Their Own Name', first_name: '', last_name: null, location_id: '   ' };
  assertEquals(buildSeed(identity(), partial), {
    first_name: 'Sarah',
    last_name: 'Johnson',
    location_id: 'loc_ABC123',
  });
});

Deno.test('buildSeed never re-points an existing location_id binding', () => {
  const bound = { studio_name: null, location_id: 'loc_SOMETHING_ELSE' };
  const seed = buildSeed(identity(), bound);
  assertEquals(seed.location_id, undefined, 'an existing binding is left alone for a human to notice');
  assertEquals(seed.studio_name, 'Dance Academy Melbourne');
});

Deno.test('buildSeed writes nothing without an identity', () => {
  assertEquals(buildSeed(null, null), {});
  assertEquals(buildSeed(null, { studio_name: '' }), {});
});

Deno.test('buildSeed omits fields the signup payload itself did not carry', () => {
  const sparse = toIdentity(row({ company_name: null, contact_first_name: null, contact_last_name: '' }))!;
  assertEquals(buildSeed(sparse, null), { location_id: 'loc_ABC123' });
});
