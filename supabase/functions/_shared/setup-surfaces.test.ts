// Run: deno test --allow-read supabase/functions/_shared/setup-surfaces.test.ts
//
// These decide whether a paying studio is shown a required step at all, so the
// two failure modes worth pinning are opposite: showing the SMS tile on day one
// (what the staging exists to stop) and never showing it (what a careless gate
// would do). The first attempt at this staging did exactly the second: it keyed
// on `status = 'active'`, and account.html hides the whole checklist at that
// point, so the tiles would have become unreachable rather than merely later.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { fromFileUrl } from 'jsr:@std/path@1';
import { ACCESS_SURFACES, messagingSurfacesFor, visibleSurfaces } from './setup-surfaces.ts';

/** A statusOf() over a plain map, with anything unlisted still pending. */
const statuses = (m: Record<string, string>) => (surface: string) => m[surface] ?? null;
const allPending = () => null;
const accessPackDone = (status = 'submitted') =>
  statuses(Object.fromEntries(ACCESS_SURFACES.map((s) => [s, status])));

Deno.test('the messaging pack is plan-gated', () => {
  assertEquals(messagingSurfacesFor('launch'), []);
  assertEquals(messagingSurfacesFor('scale'), ['sms_a2p']);
  assertEquals(messagingSurfacesFor('ai'), ['sms_a2p', 'whatsapp']);
  // A plan we do not recognise gets the access pack and nothing it cannot use.
  assertEquals(messagingSurfacesFor('enterprise'), []);
  assertEquals(messagingSurfacesFor(null), []);
});

Deno.test('day one: the access pack only, and we say more is coming', () => {
  const v = visibleSurfaces('ai', allPending);
  assertEquals(v.surfaces, [...ACCESS_SURFACES]);
  assertFalse(v.surfaces.includes('sms_a2p'), 'SMS must not be one of eight tiles on the day they paid');
  assert(v.messagingPending, 'the studio should be told a further step is coming');
});

Deno.test('one tile left untouched still holds the messaging pack back', () => {
  const nearly = Object.fromEntries(ACCESS_SURFACES.map((s) => [s, 'submitted']));
  delete nearly.tiktok;
  const v = visibleSurfaces('scale', statuses(nearly));
  assertFalse(v.surfaces.includes('sms_a2p'));
  assert(v.messagingPending);
});

Deno.test('finishing the access pack unlocks the messaging pack', () => {
  const v = visibleSurfaces('ai', accessPackDone());
  assertEquals(v.surfaces, [...ACCESS_SURFACES, 'sms_a2p', 'whatsapp']);
  assertFalse(v.messagingPending, 'nothing is pending once it is on screen');
});

Deno.test('"I do not have this yet" counts as dealt with, and so does our own queue', () => {
  // A studio with no TikTok account has finished that tile as far as they are
  // concerned. Holding their next step behind it would strand them.
  for (const status of ['no_account', 'in_progress', 'complete', 'submitted']) {
    const v = visibleSurfaces('scale', accessPackDone(status));
    assert(v.surfaces.includes('sms_a2p'), `${status} should count as dealt with`);
  }
});

Deno.test('completion is NOT required, because that is our queue and not their work', () => {
  // Every tile submitted but none actioned by us yet: the studio has done
  // everything they can, so they are not made to wait on us.
  const v = visibleSurfaces('scale', accessPackDone('submitted'));
  assert(v.surfaces.includes('sms_a2p'));
});

Deno.test('a tile already started is NEVER taken away', () => {
  // A studio who submitted SMS details before this staging shipped, and who has
  // not finished the access pack, must keep the tile they are already working
  // in. Hiding it would strand work they have already given us.
  const mid = statuses({ gbp: 'submitted', sms_a2p: 'submitted' });
  const v = visibleSurfaces('scale', mid);
  assert(v.surfaces.includes('sms_a2p'));
  assertFalse(v.messagingPending);
});

Deno.test('Launch never sees a messaging tile and is never promised one', () => {
  for (const st of [allPending, accessPackDone()]) {
    const v = visibleSurfaces('launch', st);
    assertEquals(v.surfaces, [...ACCESS_SURFACES]);
    assertFalse(v.messagingPending, 'do not promise a step this plan does not include');
  }
});

Deno.test('order is stable, so the grid never reshuffles under the studio', () => {
  const v = visibleSurfaces('ai', accessPackDone());
  assertEquals(v.surfaces.slice(0, ACCESS_SURFACES.length), [...ACCESS_SURFACES]);
  assertEquals(v.surfaces.slice(ACCESS_SURFACES.length), ['sms_a2p', 'whatsapp']);
});

Deno.test('the endpoint uses this module rather than restating the rule', () => {
  const REPO = fromFileUrl(new URL('../../../', import.meta.url));
  const endpoint = Deno.readTextFileSync(REPO + 'supabase/functions/get-studio-account/index.ts');
  assert(endpoint.includes('visibleSurfaces('), 'get-studio-account should call visibleSurfaces');
  // The literal surface lists must not come back into the entrypoint, where they
  // cannot be tested. That is how this logic went unchecked in the first place.
  assertFalse(/const\s+SURFACES_BASE\s*=/.test(endpoint), 'the access pack list is restated in the entrypoint');
  assertFalse(/'sms_a2p',\s*'whatsapp'/.test(endpoint), 'the messaging pack list is restated in the entrypoint');
});
