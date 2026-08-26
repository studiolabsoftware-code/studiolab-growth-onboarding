// Run: deno test --allow-read supabase/functions/_shared/sms-registration.test.ts
//
// The regression: the Setup Checklist's SMS tile described the US process to
// every studio. It opened on the 10DLC carrier registry, then asked a studio in
// Manchester or Auckland for a US Campaign Registry industry vertical, a US
// campaign throughput tier, and an opt-in screenshot for US Toll-Free
// verification, and promised them carrier approval nobody was waiting on.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { fromFileUrl } from 'jsr:@std/path@1';
import {
  registryFor,
  sampleSmsFor,
  smsFieldKeys,
  smsRegistrationFor,
  smsTileFor,
} from './sms-registration.ts';

const REPO = fromFileUrl(new URL('../../../', import.meta.url));
const keys = (country: string | null | undefined) => smsRegistrationFor(country).fields.map((f) => f.key);

// The three fields that exist only because the US Campaign Registry asks for them.
const REGISTRY_ONLY = ['industry_vertical', 'estimated_monthly_volume', 'opt_in_screenshot_url'];

Deno.test('only the US goes through a campaign registry we file with', () => {
  assertEquals(registryFor('US'), 'us_10dlc');
  assertEquals(registryFor('United States'), 'us_10dlc');
  for (const c of ['AU', 'NZ', 'UK', 'GB', 'CA', 'IE', '', null, undefined]) {
    assertEquals(registryFor(c), 'none', `country ${JSON.stringify(c)}`);
  }
});

Deno.test('US registry fields are asked for in the US and nowhere else', () => {
  for (const key of REGISTRY_ONLY) {
    assert(keys('US').includes(key), `a US studio should be asked for ${key}`);
    for (const c of ['AU', 'NZ', 'UK', 'CA', 'IE']) {
      assertFalse(keys(c).includes(key), `${c} must not be asked for ${key}`);
    }
  }
});

Deno.test('every studio is still asked for what we actually need to send', () => {
  const universal = ['privacy_policy_url', 'terms_url', 'business_description',
    'opt_in_method', 'opt_in_description', 'sample_sms_1', 'sample_sms_2', 'notes'];
  for (const c of ['US', 'AU', 'NZ', 'UK', 'CA', 'IE', null]) {
    for (const key of universal) {
      assert(keys(c).includes(key), `${c} must still be asked for ${key}`);
    }
  }
  // The non-US tile is genuinely shorter, which is the point: three fewer
  // questions, none of them ones we could act on.
  assertEquals(keys('AU').length + REGISTRY_ONLY.length, keys('US').length);
});

Deno.test('no country is told about a registry we have not verified for them', () => {
  for (const c of ['AU', 'NZ', 'UK', 'CA', 'IE']) {
    const model = smsRegistrationFor(c);
    const prose = [model.whatWeDo, model.whatYouNeedForGuided, ...model.stepsDfy, ...model.stepsGuided].join(' ');
    for (const usism of ['10DLC', 'Toll-Free', 'IRS', 'carrier registry']) {
      assertFalse(prose.includes(usism), `${c} should not be told about ${usism}`);
    }
    // And we do not promise an approval timeline where nobody is approving.
    assertFalse(/\d\s*-\s*\d\s*business days/.test(prose), `${c} is promised a timeline we do not own`);
  }
  // The US tile keeps all of it, because there it is true.
  assert(smsRegistrationFor('US').whatWeDo.includes('10DLC'));
});

Deno.test('STOP is everywhere, HELP only where a carrier checks for it', () => {
  for (const c of ['US', 'AU', 'NZ', 'UK', 'CA', 'IE']) {
    const { sample_sms_1, sample_sms_2 } = sampleSmsFor(c, 'Dance Academy');
    for (const msg of [sample_sms_1, sample_sms_2]) {
      assert(msg.includes('Reply STOP to opt out'), `${c}: every sample needs a working opt-out`);
      assert(msg.startsWith('Dance Academy:'), `${c}: every sample must identify the sender`);
    }
    const wantsHelp = c === 'US';
    assertEquals(sample_sms_1.includes('HELP for support'), wantsHelp, `${c}: HELP keyword`);
  }
});

Deno.test('US English for US studios, Australian English for everyone else', () => {
  assert(sampleSmsFor('US', 'X').sample_sms_2.includes('enrollments'));
  for (const c of ['AU', 'NZ', 'UK', 'CA', 'IE']) {
    assert(sampleSmsFor(c, 'X').sample_sms_2.includes('enrolments'), `${c} spells it enrolments`);
    assertFalse(sampleSmsFor(c, 'X').sample_sms_2.includes('enrollments'), c);
  }
});

Deno.test('a blank studio name never renders an empty sender', () => {
  for (const name of ['', '   ', null as unknown as string]) {
    assert(sampleSmsFor('AU', name).sample_sms_1.startsWith('Your Studio:'));
  }
});

Deno.test('smsTileFor writes the pre-fills out for the browser', () => {
  const tile = smsTileFor('UK', 'Dance Academy');
  const s1 = tile.fields.find((f) => f.key === 'sample_sms_1');
  const s2 = tile.fields.find((f) => f.key === 'sample_sms_2');
  assertEquals(s1?.defaultValue, sampleSmsFor('UK', 'Dance Academy').sample_sms_1);
  assertEquals(s2?.defaultValue, sampleSmsFor('UK', 'Dance Academy').sample_sms_2);
  // Nothing else carries one, or the studio opens a tile already full of text.
  const prefilled = tile.fields.filter((f) => f.defaultValue).map((f) => f.key);
  assertEquals(prefilled, ['sample_sms_1', 'sample_sms_2']);
});

Deno.test('the save endpoint allows every key any country tile can produce', () => {
  // A key the endpoint does not allow is SILENTLY DROPPED, so a studio fills the
  // field, sees it save, and the value never lands.
  const all = new Set<string>();
  for (const c of ['US', 'AU', 'NZ', 'UK', 'CA', 'IE', null]) keys(c).forEach((k) => all.add(k));
  for (const key of all) {
    assert(smsFieldKeys().includes(key), `smsFieldKeys() omits '${key}'`);
  }
  // And the endpoint must READ that list rather than restate it, or the two go
  // out of step the first time a field is added.
  const endpoint = Deno.readTextFileSync(REPO + 'supabase/functions/studio-save-setup-task/index.ts');
  assert(endpoint.includes('smsFieldKeys()'), 'studio-save-setup-task should source its sms_a2p keys from the model');
  assertFalse(/sms_a2p:\s*\[/.test(endpoint), 'studio-save-setup-task restates the sms_a2p field list as a literal');
});

Deno.test('account.html no longer hardcodes one country\u2019s SMS process', () => {
  // The whole defect in one assertion. If someone puts country-blind SMS copy
  // back into the tile definition, this fails.
  const page = Deno.readTextFileSync(REPO + 'account.html');
  const tileStart = page.indexOf('    sms_a2p: {');
  const tileEnd = page.indexOf('    whatsapp: {');
  assert(tileStart > 0 && tileEnd > tileStart, 'the sms_a2p tile definition moved');
  // Comments stripped, matching no-like-wildcards.test.ts: the ban is on the
  // DEFINITION, not on the prose explaining why the block is now nearly empty,
  // which names the US machinery it used to carry on purpose.
  const tile = page.slice(tileStart, tileEnd)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
  for (const usism of ['10DLC', 'Toll-Free', 'industry_vertical', 'estimated_monthly_volume', 'IRS']) {
    assertFalse(tile.includes(usism), `account.html hardcodes '${usism}' into the SMS tile again`);
  }
  // And the page reads what the server resolved.
  assert(page.includes('sms_registration'), 'account.html no longer reads the server-resolved model');
  assert(page.includes('acctState.smsRegistration'), 'account.html no longer stashes the model');
  assert(page.includes('f.defaultValue'), 'account.html no longer renders the server-written pre-fills');
});

Deno.test('a tile save never destroys what it did not ask about', () => {
  // studio-save-setup-task REPLACES setup_tasks.data rather than merging, so
  // whatever the browser omits is gone. Two ways that bit: a tile whose field
  // set shrank (the SMS one, once the US registry fields stopped being asked of
  // everybody), and the "I don't have this yet" checkbox, which used to post an
  // empty object and throw away everything the studio had typed.
  const REPO2 = fromFileUrl(new URL('../../../', import.meta.url));
  const page = Deno.readTextFileSync(REPO2 + 'account.html');
  const at = page.indexOf('const dataOut = {};');
  assert(at > 0, 'the tile save handler moved');
  const handler = page.slice(at, page.indexOf('body: JSON.stringify({ session_token: session.token, surface', at));
  // The seed must come BEFORE the `if (!noAccountFlag)`, so it runs on both paths.
  const seedAt = handler.indexOf('Object.keys(data).forEach');
  const branchAt = handler.indexOf('if (!noAccountFlag)');
  assert(seedAt > 0, 'the save no longer seeds from the stored data');
  assert(branchAt > 0, 'the no-account branch moved');
  assert(
    seedAt < branchAt,
    'the seed must run on BOTH paths: inside the branch, ticking "I don\'t have this yet" wipes the row',
  );
});
