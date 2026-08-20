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

# 3. The form is a plain script, so at minimum parse it.
node --check js/form.js
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

**`js/form.js` ships via GitHub Pages on any push to `main`,** including a push that only touches an
unrelated file. It is on a different rail from the Edge Functions, so a change that spans both must
deploy the functions FIRST and push afterwards, or studios run new client code against old server
code. Bump the `?v=` cache-buster in all six `au|us/{launch,scale,ai}/index.html` files plus
`setup/index.html` whenever `form.js` changes.
