// Run: deno test --allow-read supabase/functions/_shared/business-identifier-parity.test.ts
//
// A drift guard, not a unit test.
//
// `business-identifiers.ts` is the source of truth for two country-keyed
// catalogues: which business identifier a country issues, and which entity types
// exist there. The onboarding form has to render both, and it CANNOT import this
// module: js/form.js is a plain script served straight off GitHub Pages, with no
// bundler and no build step anywhere in this repo. So the browser carries a hand
// written copy.
//
// A hand-kept copy with no test is a copy that goes stale, and the failure is
// silent and expensive: the studio is asked for the wrong number, or for none,
// and nobody finds out until their A2P brand registration is refused weeks later.
// This test is what makes the copy safe.
//
// WHAT IT HONESTLY COVERS. It slices the catalogue and the pure functions out of
// js/form.js as source text and evaluates them, then runs BOTH implementations
// over the same matrix of countries and entity types and compares the results.
// That is behavioural parity, not a text diff, so reformatting either file is
// free and a changed label is not. It cannot cover the DOM rendering around
// those functions.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { fromFileUrl } from 'jsr:@std/path@1';
import {
  allBusinessTypeValues,
  catalogueCountries,
  businessTypeLabelFor,
  businessTypesFor,
  identifierShapeWarning,
  identifiersFor,
  normaliseCountry,
} from './business-identifiers.ts';

// fromFileUrl, not .pathname: the checkout directory is "Growth - Onboarding"
// and .pathname hands back the space percent-encoded as %20.
const REPO = fromFileUrl(new URL('../../../', import.meta.url));
// The site lives under site/ so GitHub Pages publishes one explicit folder.
const SITE = REPO + 'site/';
const FORM_JS = Deno.readTextFileSync(SITE + 'js/form.js');

/**
 * Slice a top-level declaration out of the form's source by matching braces from
 * the first `{` after the header. Deliberately dumb: it needs the header to be
 * unique, which is enforced, and it would be fooled by a brace inside a string
 * literal in one of these blocks. There is none, and a false failure here costs
 * a minute while a false pass costs a studio their SMS registration.
 */
function slice(header: string, open = '{', close = '}'): string {
  const at = FORM_JS.indexOf(header);
  assert(at >= 0, `js/form.js no longer contains: ${header.trim()}`);
  assertEquals(FORM_JS.indexOf(header, at + 1), -1, `not unique in js/form.js: ${header.trim()}`);
  const start = FORM_JS.indexOf(open, at + header.length - 1);
  assert(start >= 0, `no block after: ${header.trim()}`);
  let depth = 0;
  for (let i = start; i < FORM_JS.length; i++) {
    const ch = FORM_JS[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return FORM_JS.slice(at, i + 1);
    }
  }
  throw new Error(`unterminated block: ${header.trim()}`);
}

/** An array literal, which needs bracket matching rather than brace matching. */
const sliceArray = (header: string) => slice(header, '[', ']');

interface Spec { key: string; label: string; hint: string; digits?: number; appliesTo: string }
interface Option { value: string; label: string }
interface Browser {
  normaliseCountry(c: unknown): string;
  identifiersFor(c: unknown, bt?: unknown): Spec[];
  businessTypesFor(c: unknown): Option[];
  businessTypeLabelFor(c: unknown, v: unknown): string;
  identifierShapeWarning(spec: Spec, v: unknown): string;
  IDENTIFIER_KEYS: string[];
}

const BROWSER: Browser = (new Function(`
  ${slice('  function normaliseCountry(')}
  ${slice('  const IDENT_SPECS = ')}
  ${slice('  const IDENTIFIERS_BY_COUNTRY = ')}
  ${sliceArray('  const INCORPORATED_TYPES = [')};
  ${sliceArray('  const IDENTIFIER_KEYS = [')};
  ${slice('  function identifiersFor(')}
  ${slice('  function identifierShapeWarning(')}
  ${slice('  const BUSINESS_TYPES_BY_COUNTRY = ')}
  ${sliceArray('  const GENERIC_BUSINESS_TYPES = [')};
  ${slice('  function businessTypesFor(')}
  ${slice('  function businessTypeLabelFor(')}
  return { normaliseCountry, identifiersFor, businessTypesFor, businessTypeLabelFor,
           identifierShapeWarning, IDENTIFIER_KEYS };
`))();

// Every country the catalogue names, taken FROM the catalogue rather than typed
// out here: a hand-written list is exactly the gap that lets someone add a
// country to business-identifiers.ts, forget the copy in js/form.js, and still
// go green. Plus the spellings a stored row might hold, and countries we have
// no entry for at all.
const COUNTRIES: (string | null | undefined)[] = [
  ...catalogueCountries(),
  'AUS', 'Australia', 'USA', 'united states', 'NZL', 'New Zealand',
  'GBR', 'United Kingdom', 'CAN', 'Canada',
  'IE', 'SG', 'ZA', 'xx', '', '   ', null, undefined,
];
const TYPES = [
  '', 'sole_prop', 'partnership', 'pty_ltd', 'llc', 'corp', 'ltd', 'llp',
  'nonprofit', 'other_au', 'other', 'SOLE_PROP', 'not_a_type', null, undefined,
];

Deno.test('parity: normaliseCountry agrees on every spelling', () => {
  for (const c of COUNTRIES) {
    assertEquals(BROWSER.normaliseCountry(c), normaliseCountry(c as string), `country ${JSON.stringify(c)}`);
  }
});

Deno.test('parity: identifiersFor returns the same specs, in the same order', () => {
  for (const c of COUNTRIES) {
    for (const bt of TYPES) {
      const mine = identifiersFor(c as string, bt as string);
      const theirs = BROWSER.identifiersFor(c, bt);
      const where = `country ${JSON.stringify(c)} / type ${JSON.stringify(bt)}`;
      assertEquals(theirs.map((s) => s.key), mine.map((s) => s.key), where);
      // Labels and hints are studio-facing copy, so drift there is drift the
      // studio reads. Compare the whole spec, not just the key.
      assertEquals(
        theirs.map((s) => ({ key: s.key, label: s.label, hint: s.hint, digits: s.digits ?? null, appliesTo: s.appliesTo })),
        mine.map((s) => ({ key: s.key, label: s.label, hint: s.hint, digits: s.digits ?? null, appliesTo: s.appliesTo })),
        where,
      );
    }
  }
});

Deno.test('parity: businessTypesFor offers the same entities, in the same order', () => {
  for (const c of COUNTRIES) {
    assertEquals(
      BROWSER.businessTypesFor(c).map((o) => ({ value: o.value, label: o.label })),
      businessTypesFor(c as string).map((o) => ({ value: o.value, label: o.label })),
      `country ${JSON.stringify(c)}`,
    );
  }
});

Deno.test('parity: businessTypeLabelFor resolves the same label, including for a value the country does not offer', () => {
  for (const c of COUNTRIES) {
    for (const v of TYPES) {
      assertEquals(
        BROWSER.businessTypeLabelFor(c, v),
        businessTypeLabelFor(c as string, v as string),
        `country ${JSON.stringify(c)} / value ${JSON.stringify(v)}`,
      );
    }
  }
});

Deno.test('parity: the shape warning reads the same in the browser as on the server', () => {
  const VALUES = ['', '  ', '51 824 753 556', '5182475355', '12-3456789', '123456789', 'abc', '9429041234567'];
  for (const spec of identifiersFor('AU').concat(identifiersFor('US'), identifiersFor('NZ'), identifiersFor('UK'))) {
    for (const v of VALUES) {
      assertEquals(
        BROWSER.identifierShapeWarning(spec as unknown as Spec, v),
        identifierShapeWarning(spec, v) ?? '',
        `${spec.key} / ${JSON.stringify(v)}`,
      );
    }
  }
});

Deno.test('every identifier the catalogue can ask for has a column to land in', () => {
  // A catalogue entry with no column is silent data loss: save-draft drops what
  // it cannot write and nothing complains.
  const keys = new Set<string>();
  for (const c of COUNTRIES) {
    for (const bt of TYPES) identifiersFor(c as string, bt as string).forEach((s) => keys.add(s.key));
  }
  const migrations = ['040_business_details.sql', '054_country_business_identifiers.sql']
    .map((f) => Deno.readTextFileSync(REPO + 'supabase/migrations/' + f)).join('\n');
  const saveDraft = Deno.readTextFileSync(REPO + 'supabase/functions/save-draft/index.ts');
  for (const key of keys) {
    assert(
      new RegExp(`add column if not exists\\s+${key}\\b`).test(migrations),
      `no migration adds submissions.${key}`,
    );
    assert(saveDraft.includes(`'${key}'`), `save-draft does not allow '${key}', so it would be silently dropped`);
  }
  // The form's own list has to cover them too, or buildPayload never clears a
  // stale value when the studio's country or entity type moves.
  for (const key of keys) {
    assert(BROWSER.IDENTIFIER_KEYS.includes(key), `js/form.js IDENTIFIER_KEYS is missing '${key}'`);
  }
});

Deno.test('every form page offers every entity value, and ships the same form.js', () => {
  const PAGES = ['au/launch', 'au/scale', 'au/ai', 'us/launch', 'us/scale', 'us/ai'];
  const values = allBusinessTypeValues();
  const busters = new Set<string>();
  for (const page of PAGES) {
    const html = Deno.readTextFileSync(SITE + page + '/index.html');
    // The container js/form.js renders the identifier fields into.
    assert(html.includes('id="identifierRow"'), `${page}: no #identifierRow to render identifiers into`);
    // The three hard-coded fields are gone; leaving one behind means a duplicate
    // element id the moment form.js renders the same identifier.
    for (const dead of ['einField', 'abnField', 'acnField']) {
      assert(!html.includes(dead), `${page}: still carries the hard-coded ${dead}`);
    }
    for (const v of values) {
      assert(html.includes(`<option value="${v}">`), `${page}: businessType select has no option for '${v}'`);
    }
    const m = html.match(/\/js\/form\.js\?v=([A-Za-z0-9]+)/);
    assert(m, `${page}: no cache-busted form.js include`);
    busters.add(m![1]);
  }
  // One version string across all six, or a studio on the page you forgot runs
  // last month's form against this month's schema.
  assertEquals(busters.size, 1, `form.js cache-buster differs across pages: ${[...busters].join(', ')}`);
});
