// GitHub Pages publishes site/ and nothing else. These tests keep it that way.
//
// Until 2026-09-04 Pages served the repository root, so every committed file
// was live on app.studiolabgrowth.com: the internal engineering notes, the
// full database schema, every migration, the onboarding runbooks, and a line
// naming a paying studio with the amount they paid and their invoice number.
// Nobody published those on purpose. Publishing was the default and adding a
// folder was enough to do it.
//
// The fix was structural: an explicit publish root, so a file reaches the
// public only by being put in site/. These tests defend the two ways that can
// still go wrong. Someone repoints the workflow at the repo root, or someone
// drops an internal document into site/.

import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { fromFileUrl } from 'https://deno.land/std@0.208.0/path/mod.ts';

// fromFileUrl, not URL.pathname: this repo's directory name contains a space,
// which pathname percent-encodes into a path that does not exist on disk.
const REPO_ROOT = fromFileUrl(new URL('../../../', import.meta.url));
const WORKFLOW = `${REPO_ROOT}.github/workflows/pages.yml`;

Deno.test('Pages publishes site/ and not the repository root', () => {
  const yml = Deno.readTextFileSync(WORKFLOW);

  // upload-pages-artifact decides what becomes public. Anything but site/ here
  // and internal files are live again.
  assertStringIncludes(
    yml,
    'path: site',
    'The Pages workflow must upload site/. Publishing the repo root exposes ' +
    'the notes, the schema, the migrations and the runbooks on the customer domain.',
  );

  const paths = [...yml.matchAll(/^\s*path:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  assertEquals(
    paths,
    ['site'],
    `The workflow declares publish paths ${JSON.stringify(paths)}. Exactly one ` +
    `is allowed, and it must be site/.`,
  );

  // A deploy that skips the gate can ship a broken or leaking site.
  assertStringIncludes(
    yml,
    'needs: gate',
    'The deploy job must depend on the gate job so a red gate blocks the deploy.',
  );
});

Deno.test('nothing internal has been placed inside site/', () => {
  // The site is HTML, styles, scripts and images. Prose, SQL, TypeScript and
  // config are how internal material travels, so none of it belongs here.
  const ALLOWED = /\.(html|css|js|map|svg|png|jpg|jpeg|webp|gif|ico|woff2?|txt|pdf)$/i;
  const ALLOWED_EXTENSIONLESS = new Set(['CNAME']);
  const offenders: string[] = [];

  function walk(dir: string, rel: string) {
    for (const entry of Deno.readDirSync(dir)) {
      if (entry.name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        walk(`${dir}/${entry.name}`, relPath);
        continue;
      }
      if (ALLOWED.test(entry.name) || ALLOWED_EXTENSIONLESS.has(entry.name)) continue;
      offenders.push(relPath);
    }
  }
  walk(`${REPO_ROOT}site`, '');

  assertEquals(
    offenders,
    [],
    `site/ is published at app.studiolabgrowth.com. These are not web assets ` +
    `and would be readable by anyone: ${offenders.join(', ')}.`,
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
  // Sequential fixtures like +61412345678 are obviously synthetic. Nobody's
  // real number contains a run of 1..8, and rewriting them would only churn
  // assertions without making anyone safer.
  const SYNTHETIC = /12345678/;
  // Placeholder local-parts in documentation, e.g. `name+test@gmail.com`
  // explaining Gmail plus-addressing. Nobody is named "name".
  const PLACEHOLDER_LOCAL = /^(name|user|you|your|someone|example|test|foo|bar)([+.].*)?$/i;

  const PERSONAL_EMAIL =
    /[a-zA-Z0-9._%+-]+@(gmail|hotmail|outlook|yahoo|bigpond|icloud|live|me)\.[a-z.]+/g;
  const AU_MOBILE = /\b(?:\+?61[ -]?4|04)[0-9]{2}[ -]?[0-9]{3}[ -]?[0-9]{3}\b/g;

  // Not ours to police: dependencies, local scratch, and the working folders
  // that .gitignore already keeps out of the repo entirely.
  const SKIP = new Set(['node_modules', 'outputs', 'calculators', 'tmp', 'vendor']);
  const hits: string[] = [];

  function walk(dir: string, rel: string) {
    for (const entry of Deno.readDirSync(dir)) {
      if (entry.name.startsWith('.')) continue;
      const path = `${dir}/${entry.name}`;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        if (SKIP.has(entry.name)) continue;
        walk(path, relPath);
        continue;
      }
      if (!/\.(md|html|ts|js|mjs|sql|json|txt|css|yml)$/.test(entry.name)) continue;
      let text: string;
      try { text = Deno.readTextFileSync(path); } catch { continue; }
      for (const m of text.matchAll(PERSONAL_EMAIL)) {
        if (m[0] === OURS) continue;
        if (PLACEHOLDER_LOCAL.test(m[0].split('@')[0])) continue;
        hits.push(`${relPath}: ${m[0]}`);
      }
      for (const m of text.matchAll(AU_MOBILE)) {
        const digits = m[0].replace(/[^0-9]/g, '');
        if (SYNTHETIC.test(digits)) continue;
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
