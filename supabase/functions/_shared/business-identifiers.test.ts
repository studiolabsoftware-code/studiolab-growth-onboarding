// Run: deno test --allow-read supabase/functions/_shared/business-identifiers.test.ts
//
// The regression: identifier fields were gated on the AU/US commercial line, so
// every studio outside those two countries was asked for NO business identifier
// at all. Standard A2P brand registration needs one, so those studios could not
// be registered for SMS and nothing would have surfaced it until it failed.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import {
  allBusinessTypeValues,
  businessTypeLabelFor,
  businessTypesFor,
  identifiersFor,
  identifierShapeWarning,
  normaliseCountry,
  hasRegisterableIdentifier,
} from './business-identifiers.ts';

function keys(country: string | null | undefined, bt?: string | null) {
  return identifiersFor(country, bt).map((s) => s.key);
}

Deno.test('Australia: every business has an ABN, only companies have an ACN', () => {
  assertEquals(keys('AU', 'pty_ltd'), ['abn', 'acn']);
  assertEquals(keys('AU', 'sole_prop'), ['abn']);
  assertEquals(keys('AU', 'partnership'), ['abn']);
});

Deno.test('the US sole trader asks for nothing, which is correct', () => {
  // They register as a Sole Proprietor brand, which takes no tax ID. Asking for
  // an EIN they do not have is what pushes them down the wrong path.
  assertEquals(keys('US', 'sole_prop'), []);
  assertEquals(keys('US', 'llc'), ['ein']);
  assertEquals(keys('US', 'corp'), ['ein']);
  assertFalse(hasRegisterableIdentifier('US', 'sole_prop'));
  assert(hasRegisterableIdentifier('US', 'corp'));
});

// The gap this module exists to close.
Deno.test('countries beyond AU and US are asked for their own identifier', () => {
  assertEquals(keys('NZ', 'sole_prop'), ['nzbn']);   // NZ sole traders can hold an NZBN
  assertEquals(keys('NZ', 'ltd'), ['nzbn']);
  assertEquals(keys('UK', 'ltd'), ['crn']);
  assertEquals(keys('UK', 'sole_prop'), []);          // a UK sole trader has no company number
  assertEquals(keys('CA', 'sole_prop'), ['bn']);
});

Deno.test('an unknown country gets a generic field, never nothing', () => {
  assertEquals(keys('Singapore', 'ltd'), ['tax_id']);
  assertEquals(keys('IE', 'sole_prop'), ['tax_id']);
  assertEquals(keys('', 'ltd'), ['tax_id']);
  assertEquals(keys(null, null), ['tax_id']);
});

Deno.test('with no business type chosen yet, show everything the country issues', () => {
  assertEquals(keys('AU'), ['abn', 'acn']);
  assertEquals(keys('AU', ''), ['abn', 'acn']);
  assertEquals(keys('UK'), ['crn']);
});

Deno.test('country spellings and casing normalise', () => {
  assertEquals(normaliseCountry('australia'), 'AU');
  assertEquals(normaliseCountry(' AUS '), 'AU');
  assertEquals(normaliseCountry('United States'), 'US');
  assertEquals(normaliseCountry('New Zealand'), 'NZ');
  assertEquals(normaliseCountry('GB'), 'UK');
  assertEquals(normaliseCountry('United Kingdom'), 'UK');
  assertEquals(normaliseCountry(''), '');
  assertEquals(keys('new zealand', 'sole_prop'), ['nzbn']);
});

Deno.test('nothing here is keyed on the AU/US commercial line', () => {
  // A New Zealand studio pays on the everyone-else line but is a NZ business.
  // If this ever returns the US identifier, the two axes have been conflated.
  assertEquals(keys('NZ', 'ltd'), ['nzbn']);
  assertFalse(keys('NZ', 'ltd').includes('ein'));
});

Deno.test('shape warnings advise, and stay silent when they cannot help', () => {
  const abn = identifiersFor('AU', 'sole_prop')[0];
  assertEquals(identifierShapeWarning(abn, ''), null);          // nothing typed yet
  assertEquals(identifierShapeWarning(abn, '51 824 753 556'), null); // 11 digits, spaced
  assert(identifierShapeWarning(abn, '12345')!.includes('11 digits'));

  const crn = identifiersFor('UK', 'ltd')[0];
  assertEquals(identifierShapeWarning(crn, 'SC123456'), null);  // no fixed digit count, stays quiet
});

// ── Entity types ────────────────────────────────────────────────────────────

Deno.test('a UK LLP holds a Companies House number, so it counts as incorporated', () => {
  assertEquals(keys('UK', 'llp'), ['crn']);
  assertEquals(keys('UK', 'ltd'), ['crn']);
  // A UK sole trader has no company number at all, which is the whole reason
  // `appliesTo` exists. They register SMS on a different path.
  assertEquals(keys('UK', 'sole_prop'), []);
  assertFalse(hasRegisterableIdentifier('UK', 'sole_prop'));
});

Deno.test('each country is offered only the entities that exist there', () => {
  const vals = (c: string) => businessTypesFor(c).map((o) => o.value);
  // LLC and Corporation do not exist in Australia; Pty Ltd does not exist in the US.
  assertFalse(vals('AU').includes('llc'));
  assertFalse(vals('AU').includes('corp'));
  assertFalse(vals('US').includes('pty_ltd'));
  assertFalse(vals('US').includes('other_au'));
  assert(vals('AU').includes('pty_ltd'));
  assert(vals('US').includes('llc'));
  assert(vals('UK').includes('llp'));
  assert(vals('NZ').includes('ltd'));
  assertFalse(vals('NZ').includes('llp'));
  assert(vals('CA').includes('corp'));
});

Deno.test('a country we hold no catalogue for gets the generic list, never a borrowed US one', () => {
  const vals = businessTypesFor('IE').map((o) => o.value);
  assertFalse(vals.includes('llc'), 'an Irish studio is not an LLC and must not be told they are');
  assertFalse(vals.includes('pty_ltd'));
  assert(vals.includes('sole_prop'));
  assert(vals.includes('corp'));
  // And they are still asked for something, rather than for nothing.
  assertEquals(keys('IE'), ['tax_id']);
});

Deno.test('the same stored value reads in each country own words', () => {
  assertEquals(businessTypeLabelFor('AU', 'sole_prop'), 'Sole Trader');
  assertEquals(businessTypeLabelFor('US', 'sole_prop'), 'Sole Proprietor');
  assertEquals(businessTypeLabelFor('UK', 'sole_prop'), 'Sole trader');
});

Deno.test('a value the country does not offer still resolves, because studios move', () => {
  // A row stamped pty_ltd whose country later reads UK must not render blank.
  assertEquals(businessTypeLabelFor('UK', 'pty_ltd'), 'Pty Ltd (Australian company)');
  // Something we have never issued falls back to itself, not to an empty cell.
  assertEquals(businessTypeLabelFor('AU', 'gmbh'), 'gmbh');
  assertEquals(businessTypeLabelFor('AU', ''), '');
});

Deno.test('every value any country offers is in the list the form select must carry', () => {
  const all = allBusinessTypeValues();
  for (const c of ['AU', 'US', 'NZ', 'UK', 'CA', 'IE']) {
    for (const o of businessTypesFor(c)) {
      assert(all.includes(o.value), `${c} offers '${o.value}' but allBusinessTypeValues omits it`);
    }
  }
});
