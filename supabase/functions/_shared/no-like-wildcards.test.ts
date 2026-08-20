// Run: deno test --allow-read supabase/functions/_shared/no-like-wildcards.test.ts
//
// A source-shape guard, not a unit test. It exists because this codebase has now shipped the SAME
// defect twice: a LIKE match on a value a caller can influence turns a lookup into a pattern match,
// because `%` and `_` are LIKE wildcards.
//
// The first instance (send-otp / verify-otp, fixed 2026-08-20) let an unauthenticated caller pass an
// OTP check with a code minted for their own address and then read every submission in the table.
// The second sweep (2026-08-21) found nine more sites, including one on the PUBLIC checkout path
// where posting `%` as a discount code matched whatever code happened to be in the table, and one
// where the From header of an inbound email could file a message as sent by an admin.
//
// A comment in each file would not have stopped the third one. This does.
//
// WHAT IT HONESTLY COVERS. Source text, with comments stripped. It catches the method form
// (`.ilike(`), and the string-operator forms PostgREST also accepts (`.filter(col, 'ilike', v)`,
// `.or('col.ilike.%x%')`, `.not(col, 'like', v)`), because Codex pointed out on review that banning
// only the method call would have left three ways to write the same bug. It cannot catch a pattern
// assembled at runtime or reached through a computed property, and it does not parse TypeScript, so
// a `.ilike(` inside a string literal would trip it. That is a deliberate trade: a false positive
// costs someone a minute, a false negative costs an account.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { fromFileUrl } from 'jsr:@std/path@1';
import { normaliseDiscountCode } from './discount-code.ts';

// fromFileUrl, not .pathname: the checkout directory is "Growth - Onboarding" and .pathname would
// hand back the space percent-encoded as %20, which readTextFile then cannot find.
const FUNCTIONS_DIR = fromFileUrl(new URL('../', import.meta.url));

/**
 * Deliberate, reviewed exceptions. EMPTY, and it should stay that way.
 *
 * If you add one, it must be a lookup whose input CANNOT be influenced by any caller (not a request
 * body, not a header, not an email address someone else chose, not a verified JWT claim - `%` is a
 * legal email local-part character under RFC 5321, so even a verified address can carry one), and
 * the entry must say why in a sentence. Prefer `.eq()` on a normalised value; case-insensitivity is
 * almost never worth a wildcard, and every write path here already normalises what it stores.
 */
const ALLOWED: ReadonlyArray<{ file: string; why: string }> = [];

/** Every way this stack can express a LIKE match. The method call is only the most obvious one. */
const LIKE_FORMS: ReadonlyArray<{ pattern: RegExp; shape: string }> = [
  { pattern: /\.i?like\s*\(/, shape: '.like() / .ilike() method call' },
  // The (?:not\.)? prefix matters: PostgREST spells negation inside the operator string, so
  // .filter('email', 'not.ilike', v) is a LIKE match that the un-prefixed pattern walked straight past.
  { pattern: /\.(?:filter|not|or)\s*\([^)]*['"`](?:not\.)?i?like['"`]/, shape: "operator string, e.g. .filter(col, 'ilike', v)" },
  { pattern: /['"`][^'"`]*\.i?like\.[^'"`]*['"`]/, shape: "embedded filter, e.g. .or('col.ilike.%x%')" },
];

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory) yield* walk(`${path}/`);
    else if (entry.name.endsWith('.ts')) yield path;
  }
}

/** Source with BOTH `//` line comments and `/* *\/` block comments stripped, so the ban applies to
 *  code and not to the prose explaining the fix (every patched file names the old call in a comment
 *  on purpose). Block comments matter: without stripping them a doc comment describing this very
 *  bug would fail the gate. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

Deno.test('no Edge Function expresses a LIKE match, in any of its forms', async () => {
  const offenders: string[] = [];
  for await (const path of walk(FUNCTIONS_DIR)) {
    if (path.endsWith('no-like-wildcards.test.ts')) continue;
    const code = codeOnly(await Deno.readTextFile(path));
    const rel = path.slice(FUNCTIONS_DIR.length);
    if (ALLOWED.some((a) => a.file === rel)) continue;
    for (const { pattern, shape } of LIKE_FORMS) {
      if (pattern.test(code)) offenders.push(`${rel} (${shape})`);
    }
  }
  assertEquals(
    offenders,
    [],
    `LIKE match found in: ${offenders.join(', ')}. ` +
      '`%` and `_` are wildcards, so this is a pattern match rather than a lookup wherever the value ' +
      'can be influenced by a caller. Use .eq() on a normalised value, or add a reviewed entry to ' +
      'ALLOWED in this file saying why the input cannot be influenced.',
  );
});

Deno.test('the exception list is empty, and adding to it is a deliberate act', () => {
  // Not redundant with the test above: that one passes silently if somebody quietly appends an
  // entry. This one makes growing the list a visible, failing decision rather than a quiet one.
  assertEquals(ALLOWED.length, 0, 'ALLOWED grew. Every entry needs a reason on the record.');
});

Deno.test('every table lookup the 2026-08-21 sweep touched is still an equality match', async () => {
  // Deliberately NOT pinned to exact argument text. An earlier draft asserted whole source
  // substrings like `.eq('email', String(userData.user.email).toLowerCase())`, which Codex correctly
  // called out as blocking harmless refactors while proving nothing the ban above does not already
  // prove. This checks the weaker, durable thing: each of these files still performs its lookup by
  // equality on the column in question.
  const expectations: Array<[string, RegExp]> = [
    ['_shared/pricing.ts', /\.eq\(\s*['"]code['"]/],
    ['_shared/caller.ts', /\.eq\(\s*['"]email['"]/],
    ['inbound-message/index.ts', /\.eq\(\s*['"]email['"]/],
    ['send-handoff/index.ts', /\.eq\(\s*['"]email['"]/],
    ['manage-admin-users/index.ts', /\.eq\(\s*['"]email['"]/],
    ['create-custom-invoice/index.ts', /\.eq\(\s*['"]email['"]/],
    ['create-quote/index.ts', /\.eq\(\s*['"]email['"]/],
  ];
  for (const [rel, pattern] of expectations) {
    const source = codeOnly(await Deno.readTextFile(`${FUNCTIONS_DIR}${rel}`));
    assert(pattern.test(source), `${rel} no longer looks its row up by equality`);
  }
});

Deno.test('the discount-code normaliser is one function, and it produces what migration 049 allows', () => {
  // The old version of this test compared the reader's and writer's source for an identical string.
  // Both now import this function instead, so there is one definition rather than two to keep in
  // step, and the test can check BEHAVIOUR. What it produces has to satisfy the CHECK constraint in
  // 049 (upper-case, no whitespace, non-empty), or an admin could create a code the database refuses
  // or the checkout can never match.
  const cases = ['  early bird ', 'EARLY   BIRD', 'summer 2026', 'x'];
  for (const input of cases) {
    const out = normaliseDiscountCode(input);
    assertEquals(out, out.toUpperCase(), `${input} did not upper-case`);
    assert(!/\s/.test(out), `${input} left whitespace in "${out}"`);
    assert(out.length > 0, `${input} normalised to empty`);
  }
  assertEquals(normaliseDiscountCode('  early bird '), 'EARLY-BIRD');
  assertEquals(normaliseDiscountCode('EARLY   BIRD'), 'EARLY-BIRD');
  // Blank in, blank out. Both callers must treat '' as "no code" rather than something to look up:
  // .eq('code', '') would match a stored empty string perfectly happily.
  assertEquals(normaliseDiscountCode('   '), '');
  assertEquals(normaliseDiscountCode(null), '');
  assertEquals(normaliseDiscountCode(undefined), '');
});
