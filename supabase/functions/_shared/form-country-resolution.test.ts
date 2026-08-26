// Run: deno test --allow-read supabase/functions/_shared/form-country-resolution.test.ts
//
// The onboarding form has to answer one question before it can ask a studio for
// the right business identifier: which country are they in? That is a SEPARATE
// axis from the commercial line. There are two lines, Australia and everyone
// else, and the URL only ever says which line. A UK studio arrives on /us/, pays
// USD, and still holds a Companies House number and no EIN.
//
// This pins the order of evidence, because it has already been wrong twice in
// two different ways:
//   - keying the identifier fields off the URL region, so every studio outside
//     AU and the US was asked for no identifier at all; and
//   - the three US-line pages pre-selecting "United States" into their country
//     select on first paint, which then beat the country the signup had stamped
//     on the row, so the fix above would have gone on doing nothing for exactly
//     the studios it was written for.
//
// It runs the REAL source, sliced out of js/form.js and evaluated against a stub
// DOM, because js/form.js is a plain browser script with no bundler and cannot
// be imported. Same technique, and same limits, as business-identifier-parity.test.ts.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { fromFileUrl } from 'jsr:@std/path@1';

const REPO = fromFileUrl(new URL('../../../', import.meta.url));
const FORM_JS = Deno.readTextFileSync(REPO + 'js/form.js');

function slice(header: string, open = '{', close = '}'): string {
  const at = FORM_JS.indexOf(header);
  assert(at >= 0, `js/form.js no longer contains: ${header.trim()}`);
  assertEquals(FORM_JS.indexOf(header, at + 1), -1, `not unique in js/form.js: ${header.trim()}`);
  const start = FORM_JS.indexOf(open, at + header.length - 1);
  assert(start >= 0, `no block after: ${header.trim()}`);
  let depth = 0;
  for (let i = start; i < FORM_JS.length; i++) {
    if (FORM_JS[i] === open) depth++;
    else if (FORM_JS[i] === close) {
      depth--;
      if (depth === 0) return FORM_JS.slice(at, i + 1);
    }
  }
  throw new Error(`unterminated block: ${header.trim()}`);
}

interface Page {
  /** Region the URL puts them on: the AU pages, or the US-line pages. */
  region: 'AU' | 'US';
  /** The three US-line pages carry a country select; the AU pages carry none. */
  hasCountrySelect: boolean;
  /** What the signup stamped on the submission row, if anything. */
  rowCountry?: string;
  /** What the studio typed into the phone field. */
  phone?: string;
}

interface Form {
  getCountryValue(): string;
  resolveCountry(): string;
  countryFromPhone(p: string): string;
  syncCountrySelect(): void;
  countrySelectValue(): string;
  chooseCountry(value: string, other?: string): void;
  /** Put a value in the select the way WE do on first paint: not an answer. */
  presetSelect(value: string): void;
  setPhone(p: string): void;
}

const COUNTRY_OPTIONS = ['', 'US', 'CA', 'UK', 'NZ', 'OTHER'];

function loadForm(page: Page): Form {
  const fields: Record<string, string> = { contactPhone: page.phone || '' };
  const select = { value: '', options: COUNTRY_OPTIONS.map((value) => ({ value })) };
  const other = { value: '' };
  const els: Record<string, unknown> = page.hasCountrySelect ? { country: select, countryOther: other } : {};

  const harness = {
    REGION: page.region,
    REGION_DEFAULT_COUNTRY: { AU: 'AU', US: 'US' },
    val: (id: string) => (fields[id] || '').trim(),
    document: { getElementById: (id: string) => els[id] ?? null },
    applyCountryOtherVisibility: () => {},
  };

  const built = (new Function('h', `
    const { REGION, REGION_DEFAULT_COUNTRY, val, document, applyCountryOtherVisibility } = h;
    let ROW_COUNTRY = '';
    let COUNTRY_USER_CHOSEN = false;
    ${slice('  function normaliseCountry(')}
    ${slice('  const DIAL_TO_COUNTRY = ')}
    ${slice('  function countryFromPhone(')}
    ${slice('  function resolveCountry(')}
    ${slice('  function syncCountrySelect(')}
    ${slice('  function getCountryValue(')}
    return {
      getCountryValue, resolveCountry, countryFromPhone, syncCountrySelect,
      setRowCountry: (v) => { ROW_COUNTRY = v; },
      chose: () => { COUNTRY_USER_CHOSEN = true; },
    };
  `))(harness) as Form & { setRowCountry(v: string): void; chose(): void };

  if (page.rowCountry) built.setRowCountry(page.rowCountry);
  return {
    getCountryValue: () => built.getCountryValue(),
    resolveCountry: () => built.resolveCountry(),
    countryFromPhone: (p: string) => built.countryFromPhone(p),
    syncCountrySelect: () => built.syncCountrySelect(),
    countrySelectValue: () => select.value,
    chooseCountry: (value: string, otherText?: string) => {
      select.value = value;
      if (otherText !== undefined) other.value = otherText;
      built.chose();
    },
    presetSelect: (value: string) => { select.value = value; },
    setPhone: (p: string) => { fields.contactPhone = p; },
  };
}

Deno.test('the country the signup stamped beats the URL, on both lines', () => {
  // The whole point of the slice: a UK studio pays on the everyone-else line and
  // is still a UK business.
  assertEquals(loadForm({ region: 'US', hasCountrySelect: true, rowCountry: 'UK' }).getCountryValue(), 'UK');
  assertEquals(loadForm({ region: 'US', hasCountrySelect: true, rowCountry: 'CA' }).getCountryValue(), 'CA');
  assertEquals(loadForm({ region: 'AU', hasCountrySelect: false, rowCountry: 'NZ' }).getCountryValue(), 'NZ');
});

Deno.test('REGRESSION: our own pre-fill of the select must never overrule the row', () => {
  // The exact defect this test exists for, in the order it actually happened.
  // First paint ran before the draft hydrated, so the US-line select was filled
  // with the region default "US" by code, not by a studio. getCountryValue()
  // then read that select back as though it were an answer, which meant the row
  // country and the dial code were never reached and every studio on those three
  // pages resolved to US no matter what their signup said.
  const f = loadForm({ region: 'US', hasCountrySelect: true, rowCountry: 'UK' });
  f.presetSelect('US'); // what first paint did, before the row was known
  assertEquals(f.getCountryValue(), 'UK', 'a value WE put in the select is not the studio answering');
  // And once the row is known the mirror corrects itself, so the studio sees UK.
  f.syncCountrySelect();
  assertEquals(f.countrySelectValue(), 'UK', 'the select must MIRROR the resolved country');
  assertEquals(f.getCountryValue(), 'UK');
});

Deno.test('an international dial code is consulted when the row says nothing', () => {
  const f = loadForm({ region: 'US', hasCountrySelect: true, phone: '+44 20 7946 0958' });
  assertEquals(f.getCountryValue(), 'UK');
  f.syncCountrySelect();
  assertEquals(f.countrySelectValue(), 'UK');
  // Including on the AU pages, which is the Auckland backstop: their phone says
  // New Zealand, so they belong on the everyone-else line and get an NZBN.
  assertEquals(loadForm({ region: 'AU', hasCountrySelect: false, phone: '+64 9 123 4567' }).getCountryValue(), 'NZ');
});

Deno.test('the row still beats the dial code, because a studio can travel', () => {
  const f = loadForm({ region: 'US', hasCountrySelect: true, rowCountry: 'CA', phone: '+44 20 7946 0958' });
  assertEquals(f.getCountryValue(), 'CA');
});

Deno.test('a national-format number is not evidence of anything', () => {
  const f = loadForm({ region: 'AU', hasCountrySelect: false, phone: '0421 056 987' });
  assertEquals(f.countryFromPhone('0421 056 987'), '');
  assertEquals(f.getCountryValue(), 'AU', 'falls through to the URL region');
  // +1 is shared by the US and Canada, so it is ambiguous and must not be read
  // as either: guessing US asks a Toronto studio for an EIN they do not have.
  assertEquals(f.countryFromPhone('+1 416 555 0143'), '');
  assertEquals(loadForm({ region: 'US', hasCountrySelect: true, phone: '+1 416 555 0143' }).getCountryValue(), 'US');
});

Deno.test('the studio answering for themselves beats everything we inferred', () => {
  const f = loadForm({ region: 'US', hasCountrySelect: true, rowCountry: 'US', phone: '+44 20 7946 0958' });
  assertEquals(f.getCountryValue(), 'US');
  f.chooseCountry('CA');
  assertEquals(f.getCountryValue(), 'CA', 'they know where they are and we are only guessing');
  // And once they have answered, our mirror stops writing over their answer.
  f.syncCountrySelect();
  assertEquals(f.countrySelectValue(), 'CA');
});

Deno.test('"Other (enter below)" carries the free text they typed', () => {
  const f = loadForm({ region: 'US', hasCountrySelect: true });
  f.chooseCountry('OTHER', 'Ireland');
  assertEquals(f.getCountryValue(), 'Ireland');
});

Deno.test('with nothing to go on, the URL region is the last resort', () => {
  assertEquals(loadForm({ region: 'AU', hasCountrySelect: false }).getCountryValue(), 'AU');
  assertEquals(loadForm({ region: 'US', hasCountrySelect: true }).getCountryValue(), 'US');
});

Deno.test('a row country the select has no option for still resolves', () => {
  // Ireland is not in the six-option list. The mirror leaves the select alone
  // rather than snapping it to something wrong, and the row value still wins.
  const f = loadForm({ region: 'US', hasCountrySelect: true, rowCountry: 'Ireland' });
  f.syncCountrySelect();
  assertEquals(f.getCountryValue(), 'Ireland');
  assertEquals(f.countrySelectValue(), '', 'no option matches, so nothing is mirrored');
});
