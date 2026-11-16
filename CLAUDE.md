# Growth - Onboarding
The StudioLAB Growth onboarding system: the signup form for each plan (Launch, Scale, AI) on the AU and US lines, the post-payment studio portal, quotes and invoices, and the admin dashboard. Used by studios and Gary's team. LIVE: one paying studio is being onboarded. This repo is PUBLIC. Always say "StudioLAB Growth"; never name the vendor platform under it, in any file, comment or check line.

## 1. How it is built
Static site in `site/` (GitHub Pages, `app.studiolabgrowth.com`), Supabase Edge Functions (plain Deno, `esm.sh` imports) and Postgres. Stripe (ONE shared account, AUD and USD), Mailgun. Sibling repo `Growth Connector/` captures signups into this database.

## 2. Folder map
- `site/`: the ONLY published folder. Forms in `site/au|us/{launch,scale,ai}/`, `site/setup/`, portal, admin in `site/admin/`.
- `supabase/functions/<name>/index.ts`: one folder per function. `supabase/functions/_shared/`: tested logic. `supabase/migrations/`: numbered SQL. `supabase/config.toml`: per-function `verify_jwt`.
- `scripts/check-inline-js.mjs`: parses every client script. Other `scripts/*.js`: generators.
- `outputs/`, `calculators/`, `tmp/`: local working folders, gitignored, confidential. Never commit from them.
- `docs/claude-context.md`: full detail.

## 3. Commands
No install step (no package.json, no deno.json). Run from the repo root. No `.green-gate` file, so `~/.claude/bin/green-gate` is not the gate here. The gate is the three commands CI runs (`pages.yml` job `gate`; red blocks the deploy):
```bash
cd "/Users/gary/Claude_Projects/Growth - Onboarding"
~/.claude/bin/heavy bash -c 'for f in supabase/functions/*/index.ts; do deno check "$f" || exit 1; done'
~/.claude/bin/heavy deno test --allow-read supabase/functions/_shared/
~/.claude/bin/heavy node scripts/check-inline-js.mjs
```
Ignore the `BASHRC_WAS_SOURCED` line. Deploy one function (from the root): `supabase functions deploy <name>`. Apply SQL by hand: `supabase db query --linked -f supabase/migrations/<NNN_name>.sql`.

## 4. Coding rules for this repo
- THE SITE IS `site/` ONLY. Never repoint `path:` in `pages.yml` at the repo root. Never set the Pages source back to a branch (it must stay "GitHub Actions").
- Put nothing in `site/` that is not a web asset. Never write a studio name, payment amount, invoice number or record id into a tracked file: look it up in the live database.
- The repo is public. Commit by path: `git commit -m "..." -- <path>`. Never `git add -A`. Never `git add -f` a file from `outputs/` or `calculators/` unless Gary said to publish it.
- `site/js/form.js` ships on ANY push to `main`. Deploy the Edge Functions FIRST, then push. Bump the `?v=` cache-buster in the six `site/au|us/{launch,scale,ai}/index.html` files and `site/setup/index.html` when `form.js` changes.
- Testable logic goes in `_shared/`, not `index.ts`. Use ONE template literal for a multi-line `.select()` list, or supabase-js typing breaks.
- Every function authenticates its own request body. `verify_jwt` is not app auth.
- Deploy WITHOUT `--no-verify-jwt`. If a function must have the gateway check off, add it to `supabase/config.toml` first.
- Side-effect emails (webhook or database write) go through `sendGated` and gate on `stripe_mode`.
- Money work: read `StudioLAB-Shared/gate-cards/Growth---Onboarding/money.md` first. One Stripe account; two lines only (AU, everyone else = US).
- A field that stops applying is OMITTED, never nulled: never erase what a studio gave us.
- Pricing questions: start at `outputs/studiolab-growth-knowledge-base/agent-quick-start.md` (see `docs/claude-context.md`).
- Copy: Australian English and AUD; US copy for US studios.

## 5. Design rules
Public form pages and an admin portal, not the React platform canon. Reuse `site/css/` and the neighbouring page before writing markup. Brand and copy: skill `studiolab-brand`.

## 6. Mistakes a weaker model makes here
- Checks only the function touched. CI checks ALL; deploys never run `deno check`, so old errors surface.
- Pushes `form.js` before deploying functions: studios then run new client code on old server code. Deploy first.
- Runs `git add -A`: it once would have staged 211 confidential files.
- Puts a studio name or amount in `IN-FLIGHT.md` or a doc: it leaked once.
- Redeploys `inbound-message` plainly: it is NOT in `config.toml`, so JWT comes back on and inbound mail 401s. Add it to `config.toml` first.
- Runs `supabase db push`: the remote migration list is empty, so it replays all 54 against live. Apply files by hand.
- Proposes two Stripe accounts, per-country lines or a refund for the paying studio. All settled.
- Changes `automatic_tax` or flips `stripe_mode` live. Ask Gary.

## 7. Before saying a task is done
- Type-check loop above: no `error:` lines.
- `deno test` line: ends `ok | N passed | 0 failed`.
- `node scripts/check-inline-js.mjs`: exits 0 (check with `echo $?`, prints `0`).
- `git status --short`: only the paths you meant. Nothing from `outputs/`, `calculators/`, `tmp/`.
- `git diff origin/main --stat -- .github/workflows/pages.yml`: empty unless asked.
- `grep -rn -i "<vendor name>" <changed files>`: no output (use the vendor's real name in the pattern).
- If `form.js` changed: `grep -c "form.js?v=" site/au/launch/index.html` shows the new value, and the functions were deployed before the push.

## 8. Where we work and where to look things up
Feature branch; PR into our own `origin/main` (`studiolabsoftware-code/studiolab-growth-onboarding`); Claude merges after the gate and an adversary pass. Not handed over. Steward: Growth - Onboarding steward (card `.claude/worktrees/guided-removal-and-mobile/handovers/steward.md`, per `StudioLAB-Shared/STEWARDS.md`). Live state: `IN-FLIGHT.md`; history `IN-FLIGHT-HISTORY.md`; hub `StudioLAB-Shared/projects/growth-onboarding/PROJECT.md`. Codex reads `AGENTS.md`.
Look-up: `StudioLAB-Shared/BRAIN-INDEX.md`, section 3, "Short entries" (Growth - Onboarding).
