// This repo IS the website. GitHub Pages serves the branch root at
// app.studiolabgrowth.com, so every file committed here is published on the
// customer-facing domain unless _config.yml excludes it.
//
// On 2026-09-04 that meant the internal engineering notes, the full database
// schema, every migration, the onboarding runbooks and a line naming a paying
// studio with the amount they paid and their invoice number were all readable
// at app.studiolabgrowth.com. Nobody had done anything wrong; publishing was
// simply the default, and the default was silent.
//
// Jekyll offers no allow-list, only a deny-list, so _config.yml cannot notice
// a new folder. This test is what notices. Add a top-level entry and the gate
// fails until you say, here, whether the public may read it.

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { fromFileUrl } from 'https://deno.land/std@0.208.0/path/mod.ts';

// fromFileUrl, not URL.pathname: this repo's directory name contains a space,
// which pathname percent-encodes into a path that does not exist on disk.
const REPO_ROOT = fromFileUrl(new URL('../../../', import.meta.url));

// The customer-facing site. Everything here is deliberately public.
const SERVED = new Set([
  'index.html', 'account.html', 'portal.html', 'project.html', 'quote.html',
  'update.html', 'payment-confirm.html', 'unsubscribe.html',
  'admin', 'assets', 'au', 'css', 'js', 'setup', 'us',
  'CNAME', 'robots.txt', '_config.yml',
]);

function excludedByConfig(): Set<string> {
  const yml = Deno.readTextFileSync(`${REPO_ROOT}_config.yml`);
  const out = new Set<string>();
  let inExclude = false;
  for (const raw of yml.split('\n')) {
    const line = raw.trimEnd();
    if (/^exclude:/.test(line)) { inExclude = true; continue; }
    if (inExclude && /^\S/.test(line)) break;
    const m = line.match(/^\s*-\s*(.+?)\/?\s*$/);
    if (inExclude && m) out.add(m[1]);
  }
  return out;
}

Deno.test('every top-level entry is either served on purpose or excluded from Pages', () => {
  const excluded = excludedByConfig();
  const unclassified: string[] = [];

  for (const entry of Deno.readDirSync(REPO_ROOT)) {
    // Jekyll never publishes dot-entries, so they cannot leak this way.
    if (entry.name.startsWith('.')) continue;
    if (SERVED.has(entry.name) || excluded.has(entry.name)) continue;
    unclassified.push(entry.name);
  }

  assertEquals(
    unclassified,
    [],
    `Top-level ${unclassified.join(', ')} is neither on the served allow-list nor ` +
    `excluded in _config.yml, so GitHub Pages would publish it at ` +
    `app.studiolabgrowth.com. Add it to SERVED here if the public may read it, ` +
    `otherwise add it to the exclude list in _config.yml.`,
  );
});

Deno.test('no customer contact details anywhere in the repo', () => {
  // Gary's own business address is published on purpose: studios add it to
  // grant us access, and it is seeded as the owner admin.
  const OURS = 'studiolabsoftware@gmail.com';
  // Our own published support lines, printed in the legal pages on purpose.
  const OUR_NUMBERS = ['61 468 055 053', '0468 055 053'];
  // ACMA reserves 0491 570 006-015 for documentation and fiction, so an
  // example number in a doc is not a person's number.
  const RESERVED_EXAMPLES = ['0491 570 006'];
  const PERSONAL_EMAIL =
    /[a-zA-Z0-9._%+-]+@(gmail|hotmail|outlook|yahoo|bigpond|icloud|live|me)\.[a-z.]+/g;
  const AU_MOBILE = /\b(?:\+?61[ -]?4|04)[0-9]{2}[ -]?[0-9]{3}[ -]?[0-9]{3}\b/g;

  const skipDirs = new Set(excludedByConfig());
  const hits: string[] = [];

  function walk(dir: string, rel: string) {
    for (const entry of Deno.readDirSync(dir)) {
      if (entry.name.startsWith('.')) continue;
      const path = `${dir}/${entry.name}`;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        // Skip only what Pages already excludes and what is not ours to police.
        if (skipDirs.has(relPath) || entry.name === 'node_modules') continue;
        walk(path, relPath);
        continue;
      }
      if (!/\.(md|html|ts|js|mjs|sql|json|txt|css|yml)$/.test(entry.name)) continue;
      let text: string;
      try { text = Deno.readTextFileSync(path); } catch { continue; }
      for (const m of text.matchAll(PERSONAL_EMAIL)) {
        if (m[0] !== OURS) hits.push(`${relPath}: ${m[0]}`);
      }
      for (const m of text.matchAll(AU_MOBILE)) {
        const digits = m[0].replace(/[^0-9]/g, '');
        const allowed = [...OUR_NUMBERS, ...RESERVED_EXAMPLES];
        if (allowed.some((n) => digits.endsWith(n.replace(/[^0-9]/g, '')))) continue;
        hits.push(`${relPath}: ${m[0]}`);
      }
    }
  }
  walk(REPO_ROOT.replace(/\/$/, ''), '');

  assertEquals(
    hits,
    [],
    `Customer contact details found in a PUBLIC repo: ${hits.join('; ')}. ` +
    `Look identifiers up in the live database instead of writing them down here.`,
  );
});
