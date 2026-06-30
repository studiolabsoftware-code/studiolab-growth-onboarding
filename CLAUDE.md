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

For StudioLAB Growth pricing, margin structure, setup fees, upgrade pricing, plan packaging, Family App / Communities notes, source authority, and open cost gaps, read:

`/Users/gary/Claude_Projects/Growth - Onboarding/outputs/studiolab-growth-knowledge-base/agent-quick-start.md`

Then open the relevant file in:

`/Users/gary/Claude_Projects/Growth - Onboarding/outputs/studiolab-growth-knowledge-base/`

This is the shared knowledge base for Claude and Codex-style sessions. Do not rely on old chat exports or April 2026 pricing files until the fact has been promoted into this folder or confirmed by the current catalog/code.

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

Continuously self-monitor context. The instant it reaches 60% (or at any natural task or slice boundary, whichever comes first), STOP all work immediately and emit a ready-to-paste HANDOVER PROMPT as a single fenced code block, then start a fresh session. Do not push toward the limit or rely on auto-compaction; the handover takes priority over finishing the current step. Gary may demand it at any time; produce it immediately. Full rule: StudioLAB-Shared/EXECUTION-ROUTING-STANDARD.md.
