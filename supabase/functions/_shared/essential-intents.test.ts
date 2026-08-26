// Run: deno test --allow-read supabase/functions/_shared/essential-intents.test.ts
//
// A source-shape guard, in the same spirit as no-like-wildcards.test.ts.
//
// `studio-email.ts` decides whether a studio's opt-out may suppress an email by
// looking its `intent` string up in a hand-maintained Set, by EXACT STRING
// EQUALITY. That means a typo, a rename, or a new financial email added without
// touching the Set silently downgrades an essential message to optional, and an
// opted-out studio stops receiving it. Nothing fails, nothing logs an error, and
// the studio simply never gets their receipt. That is the same silent-failure
// shape as the placeholder Vault secrets and the unlisted verify_jwt found on
// 2026-08-26, so it gets a test rather than a comment.
//
// The rule this protects: a studio can never lose a financial or account
// document by opting out. Receipts are transactional. (Invoices never reach this
// gate at all: they are sent by Stripe via collection_method='send_invoice',
// not through Mailgun, so an opt-out cannot touch them.)
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { fromFileUrl } from 'jsr:@std/path@1';
import { isEssential } from './studio-email.ts';

const FUNCTIONS_DIR = fromFileUrl(new URL('../', import.meta.url));

/**
 * Intents that are deliberately OPTIONAL, reviewed one by one. An intent must
 * appear here or in ESSENTIAL_INTENTS; anything else fails the test, which is
 * the point. Adding a row is a decision, not a formality: if the email carries
 * money, an invoice, a receipt, a refund or account access, it belongs in
 * ESSENTIAL_INTENTS instead.
 */
const KNOWN_OPTIONAL: ReadonlyArray<{ intent: string; why: string }> = [
  { intent: 'setup-task-nudge', why: 'A reminder to finish setup. Marketing-adjacent, genuinely optional.' },
  { intent: 'orphan quote cancel', why: 'Housekeeping notice that an unclaimed draft quote was cancelled.' },
  { intent: 'studio self-edit', why: 'Confirmation echo of a change the studio just made themselves.' },
  { intent: 'studio service request', why: 'Acknowledgement of a request the studio just submitted.' },
  // Admin-facing. These go to our own team via resolveAdminNotificationRecipients,
  // not to a studio, so a studio opt-out is not the relevant control for them.
  { intent: 'admin notification', why: 'Internal, addressed to the StudioLAB team.' },
  { intent: 'admin new submission', why: 'Internal, addressed to the StudioLAB team.' },
  { intent: 'admin change request completed', why: 'Internal, addressed to the StudioLAB team.' },
  { intent: 'admin invoice.payment_failed', why: 'Internal dunning alert to the StudioLAB team.' },
];

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory) yield* walk(`${path}/`);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) yield path;
  }
}

/** Comments stripped, so prose naming an intent does not count as a call site. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

/** Both spellings that reach sendIfAllowed: `intent: 'x'` and `intent = 'x'`. */
const INTENT_FORMS = [/intent\s*:\s*'([^']+)'/g, /intent\s*=\s*'([^']+)'/g];

async function collectIntents(): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for await (const file of walk(FUNCTIONS_DIR)) {
    const code = codeOnly(await Deno.readTextFile(file));
    for (const re of INTENT_FORMS) {
      for (const m of code.matchAll(re)) {
        const rel = file.replace(FUNCTIONS_DIR, '');
        const seen = found.get(m[1]) || [];
        if (!seen.includes(rel)) seen.push(rel);
        found.set(m[1], seen);
      }
    }
  }
  return found;
}

Deno.test('every intent in the codebase is classified deliberately', async () => {
  const found = await collectIntents();
  assert(found.size > 0, 'scanner found no intents at all, so it is not actually scanning');

  const optional = new Set(KNOWN_OPTIONAL.map((r) => r.intent));
  const unclassified = [...found.entries()]
    .filter(([intent]) => !isEssential(intent) && !optional.has(intent))
    .map(([intent, files]) => `  '${intent}'  (${files.join(', ')})`);

  assertEquals(
    unclassified.length,
    0,
    'Unclassified email intent(s). Add each to ESSENTIAL_INTENTS in studio-email.ts if the email ' +
    'carries money, an invoice, a receipt, a refund or account access, otherwise add it to ' +
    'KNOWN_OPTIONAL in this test with a reason:\n' + unclassified.join('\n'),
  );
});

// The rule itself, asserted directly rather than inferred from the sweep above.
Deno.test('a studio can never opt out of a payment receipt', () => {
  for (const intent of [
    'studio receipt (immediate)',
    'studio receipt (hold)',
    'studio receipt (save card)',
  ]) {
    assert(isEssential(intent), `${intent} must be essential: a receipt is a financial record`);
  }
});

Deno.test('account access and state-change emails are essential', () => {
  for (const intent of ['verification code', 'change request magic link', 'studio activated']) {
    assert(isEssential(intent), `${intent} must be essential`);
  }
});

Deno.test('the receipt intents the webhook actually sets are the ones it declares', async () => {
  // Guards the rename case: stripe-webhook assigns these to a variable, so a
  // typo there would not be caught by reading studio-email.ts alone.
  const code = codeOnly(await Deno.readTextFile(`${FUNCTIONS_DIR}stripe-webhook/index.ts`));
  const set = [...code.matchAll(/intent\s*=\s*'([^']+)'/g)].map((m) => m[1]);
  assert(set.length >= 3, `expected the three receipt intents, found ${set.length}`);
  for (const intent of set) {
    assert(isEssential(intent), `stripe-webhook sets intent '${intent}', which is NOT essential`);
  }
});
