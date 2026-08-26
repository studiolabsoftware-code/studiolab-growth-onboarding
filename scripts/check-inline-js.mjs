#!/usr/bin/env node
// Parse-check the JavaScript that lives INSIDE our HTML pages.
//
// WHY. `node --check js/form.js` covers the one client script that has its own
// file. It does not cover account.html, which carries roughly two thousand lines
// of inline JavaScript and is the whole post-payment portal: the Setup
// Checklist, the Messages composer, the self-edit sections, the invoice list. A
// syntax error in there is a blank page for a studio who has already paid, and
// nothing in the gate would have caught it before the browser did.
//
// Extracts every inline <script> block (anything without a src=) from each page
// and runs it through node --check. Deliberately dumb about module semantics: it
// is a syntax check, not a linter, and a syntax check is exactly what was
// missing.

import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// Every page that carries inline script we actually ship to a studio or an admin.
const PAGES = [
  'account.html',
  'portal.html',
  'project.html',
  'quote.html',
  'payment-confirm.html',
  'update.html',
  'unsubscribe.html',
];

const scratch = mkdtempSync(join(tmpdir(), 'slg-inline-js-'));
let checked = 0;
let failed = 0;

for (const page of PAGES) {
  let html;
  try {
    html = readFileSync(join(REPO, page), 'utf8');
  } catch {
    console.error(`  ? ${page} (not found, skipped)`);
    continue;
  }
  // Inline only: a <script src=...> block has no body of ours to check.
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1])
    .filter((b) => b.trim());
  if (!blocks.length) continue;
  const out = join(scratch, page.replace(/[^\w.-]/g, '_') + '.js');
  writeFileSync(out, blocks.join('\n;\n'));
  try {
    execFileSync(process.execPath, ['--check', out], { stdio: 'pipe' });
    console.log(`  ok ${page} (${blocks.length} inline block${blocks.length === 1 ? '' : 's'})`);
    checked++;
  } catch (err) {
    failed++;
    console.error(`  FAIL ${page}`);
    console.error(String(err.stderr || err.message).trim());
  }
}

// And every standalone client script, not just js/form.js. The gate used to name
// one file, so admin/js/detail.js and the portal's own scripts shipped unparsed.
for (const dir of ['js', 'admin/js']) {
  let entries;
  try {
    entries = readdirSync(join(REPO, dir)).filter((f) => f.endsWith('.js')).sort();
  } catch {
    continue;
  }
  for (const file of entries) {
    const rel = `${dir}/${file}`;
    try {
      execFileSync(process.execPath, ['--check', join(REPO, rel)], { stdio: 'pipe' });
      checked++;
    } catch (err) {
      failed++;
      console.error(`  FAIL ${rel}`);
      console.error(String(err.stderr || err.message).trim());
    }
  }
  console.log(`  ok ${dir}/ (${entries.length} script${entries.length === 1 ? '' : 's'})`);
}

if (failed) {
  console.error(`\nclient JS: ${failed} file(s) failed to parse`);
  process.exit(1);
}
console.log(`client JS: ${checked} file(s) parse clean`);
