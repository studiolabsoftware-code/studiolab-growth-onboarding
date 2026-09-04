# StudioLAB Growth — Onboarding: Claude operating context

This project covers StudioLAB Growth's onboarding flows — the journey from a studio signing up to becoming an active platform user. StudioLAB Growth is the marketing add-on; the underlying white-label platform is never named directly in customer-facing material or internal project outputs — always say "StudioLAB Growth."

## Claude is technical lead

Gary is the platform owner and is not technically trained. **Claude is the designated technical lead** for this project and the entire StudioLAB platform.

- Claude makes technical decisions (stack, architecture, patterns)
- Gary makes business decisions (priority, scope, customer messaging, ship timing)
- Claude gives **one specific recommendation with reasoning**, not a menu of options
- Claude pushes back when an ask is structurally unsound
- Claude takes initiative on quality concerns

**Canonical operating model:** `/Users/gary/Claude_Projects/StudioLAB-Shared/UNDERSTANDING.md`

**Global rules:** `/Users/gary/.claude/CLAUDE.md` — section "Claude as Technical Lead"

## Cross-reference: Business knowledge base

For business, product, and commercial framing (brand voice, design system, Master Design Brief, marketing operation, website strategy, per-market commercial info, and the AI personalisation profile), refer to the **studiolab-context** knowledge base at https://github.com/StudioLAB-Builds/studiolab-context (local: `/Users/gary/Claude_Projects/StudioLAB-Builds/studiolab-context/`).

## Cross-reference: Growth pricing and margin knowledge base

For StudioLAB Growth pricing, margin structure, setup fees, upgrade pricing, plan packaging, Family App / Communities notes, source authority, and open cost gaps, start with the Dropbox active source of truth:

`/Users/gary/Library/CloudStorage/Dropbox/Gary's Files/StudioLAB/Growth - GHL/StudioLAB Growth/ACTIVE_SOURCE_OF_TRUTH/00-agent-start/agent-quick-start-current.md`

Then use the local working mirror:

`/Users/gary/Claude_Projects/Growth - Onboarding/outputs/studiolab-growth-knowledge-base/agent-quick-start.md`

Then open the relevant file in:

`/Users/gary/Claude_Projects/Growth - Onboarding/outputs/studiolab-growth-knowledge-base/`

This is the shared knowledge base for Claude and Codex-style sessions. Do not rely on old chat exports, archived pricing files, old upgrade addendums, or generated PDFs until the fact has been promoted into the Dropbox active source or confirmed by the current catalog/code.

Most relevant files for any web design, copy, or brand work on Growth onboarding surfaces:
- `00-Core/Brand-Voice.md` - voice rules and copy conventions
- `00-Core/Personalisation-Profile.md` - Gary's working style for AI sessions
- `01-Platform-Modules/StudioLAB-Growth.md` - product framing and the strict naming rule (never name the underlying platform)
- `02-Architecture/Master-Design-Brief.md` - authoritative source for Growth landing pages and any visual surface

**StudioLAB-Shared remains the canonical reference** for technical and platform decisions, the Gary / AI operating model (`UNDERSTANDING.md`), the platform state and decision log (`PLATFORM-KNOWLEDGE-BASE.md`), and the live API reference (`studiolab-api-documentation.md`). The two knowledge bases are complementary, not duplicative.

## Growth-specific conventions

- Never refer to the underlying white-label platform by name - always "StudioLAB Growth"
- Naming rules for Growth surfaces follow the global CLAUDE.md "StudioLAB Growth" convention
- US English in copy targeting US studios; Australian English by default
- Onboarding sequence work pairs with StudioLAB platform onboarding — coordinate so they don't diverge

## StudioLAB platform API reference

`/Users/gary/Claude_Projects/StudioLAB-Shared/studiolab-api-documentation.md` — full API contract for the live StudioLAB platform. Reference when Growth onboarding flows need to integrate with the platform (account creation, family setup, initial enrolment, etc.).
## Session handover (HARD RULE, no exceptions)

Budget the session by TASK SIZE and natural slice boundaries, not by watching a context percentage (a session cannot reliably read its own context usage; see SESSION-STARTUP-CHECK.md §4). Treat ~60% as an intent, wrap before you are deep, not a gauge to watch. At each slice or task boundary decide deliberately: wrap here, or start exactly one more small slice. When wrapping, or the instant Gary asks, STOP all work immediately and emit a ready-to-paste HANDOVER PROMPT as a single fenced code block, then start a fresh session. Do not push toward the limit or rely on auto-compaction; the handover takes priority over finishing the current step. Full rule: StudioLAB-Shared/EXECUTION-ROUTING-STANDARD.md.

## Green gate (added 2026-08-20 — this repo previously had none)

There is no npm test harness here and no `deno.json`; the Edge Functions are plain Deno with
`https://esm.sh` imports. That is why the gate is three commands rather than one, and why it is
written down: a session that does not know these exist will ship auth changes with nothing run.

```bash
# 1. Type-check every function you touched (catches what a browser never will).
deno check supabase/functions/<function>/index.ts

# 2. Run the unit tests. Deno's runner needs nothing installed and nothing committed but the tests.
#    --allow-read, and the whole directory rather than one file: no-like-wildcards.test.ts scans the
#    Edge Function sources for `.ilike(` and needs to read them.
deno test --allow-read supabase/functions/_shared/

# 3. The client ships unbundled, so at minimum parse all of it. This covers the
#    inline <script> in account.html (~2,000 lines, the whole post-payment
#    portal) plus every file in js/ and admin/js/. The gate used to name
#    js/form.js alone, so a syntax error anywhere else reached the browser first.
#    Paths are under site/ since 2026-09-04.
node scripts/check-inline-js.mjs
```

**Four functions did not type-check at all until 2026-08-21** (`manage-admin-users`,
`create-custom-invoice`, `create-quote`, `manage-discount-codes`), because the gate above did not
exist before 2026-08-20 and nobody had ever run `deno check` on them. All four are clean now. If you
touch a function that has never been checked, expect to fix something unrelated to your change, and
fix it rather than skipping the gate.

**Put testable logic in `supabase/functions/_shared/`, not in an `index.ts`.** The entrypoints cannot
be imported under `deno test` without a Deno runtime and live env vars, so anything embedded in one is
effectively untestable. `_shared/prebind.ts` is the pattern: pure functions plus an injected
dependency, with the entrypoint reduced to wiring.

**Type-check the function you touched, and expect to fix what you find.** Several functions have
never been through `deno check` because deploys do not run it. `get-studio-account` had 58 errors
on 2026-08-26, all from one cause: its `.select()` column list was built by string concatenation,
and supabase-js can only parse that list at the type level when it is a SINGLE literal, so the row
resolved to `GenericStringError` and every property read off it was an error. Use one template
literal for a multi-line column list.

## THE SITE IS site/ AND ONLY site/ (structural fix, 2026-09-04)

`app.studiolabgrowth.com` is published from **`site/`** by
`.github/workflows/pages.yml`. Nothing else in this repo reaches the public.

It used to be the opposite. Pages served the **branch root**, so every committed file was live on
the customer domain: `IN-FLIGHT.md`, `IN-FLIGHT-HISTORY.md`, `CLAUDE.md`, all of `docs/` and
`supabase/` (full schema and every migration), the tracked plans in `outputs/`, and a line in
`IN-FLIGHT.md` naming a paying studio with the amount they paid and their invoice number.
`robots.txt` was `Disallow: /` so none of it was search-indexed, but all of it was readable by
anyone with the URL. Nobody chose to publish any of it. Publishing was the default, and adding a
folder was enough to do it.

A deny-list was tried first and rejected: it cannot notice a new folder. The publish root is an
allow-list by construction, which is why this is the shape the fix took.

**Rules that follow from it:**

- A file is public **only** by being in `site/`. Put nothing there that is not a web asset.
- **Never repoint `path:` in the workflow at the repo root.** That single line is the boundary.
- **Do not switch the Pages source back to a branch** in repo settings. Build type must stay
  "GitHub Actions". A branch-root source republishes everything.
- The workflow runs the full green gate **before** deploying, so a red gate cannot ship.
- **Never write a studio's name, payment amount, invoice number or record id into a tracked
  file.** Look identifiers up in the live database. `IN-FLIGHT.md` is read by every session and
  is the file that leaked, precisely because handovers get pasted into it.
- Path-anchored `.gitignore` rules broke in the move (`assets/*.docx` stopped matching once the
  folder became `site/assets/`, which silently un-ignored a real internal document). If you move
  a folder, re-check every gitignore rule that names it.

`supabase/functions/_shared/no-published-internals.test.ts` enforces the first three points plus
the contact-details rule, and runs in the normal gate.

**`site/js/form.js` ships via GitHub Pages on any push to `main`,** including a push that only
touches an unrelated file. It is on a different rail from the Edge Functions, so a change that
spans both must deploy the functions FIRST and push afterwards, or studios run new client code
against old server code. Bump the `?v=` cache-buster in all six
`site/au|us/{launch,scale,ai}/index.html` files plus `site/setup/index.html` whenever
`form.js` changes.
