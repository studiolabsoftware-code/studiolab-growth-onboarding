# StudioLAB Growth — Onboarding: Claude operating context

This project covers StudioLAB Growth's onboarding flows — the journey from a studio signing up to becoming an active platform user. StudioLAB Growth is the marketing add-on; the underlying platform (GoHighLevel / GHL) is never named directly in customer-facing material — always say "StudioLAB Growth."

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

Most relevant files for any web design, copy, or brand work on Growth onboarding surfaces:
- `00-Core/Brand-Voice.md` - voice rules and copy conventions
- `00-Core/Personalisation-Profile.md` - Gary's working style for AI sessions
- `01-Platform-Modules/StudioLAB-Growth.md` - product framing and the strict naming rule (never name the underlying platform)
- `02-Architecture/Master-Design-Brief.md` - authoritative source for Growth landing pages and any visual surface

**StudioLAB-Shared remains the canonical reference** for technical and platform decisions, the Gary / AI operating model (`UNDERSTANDING.md`), the platform state and decision log (`PLATFORM-KNOWLEDGE-BASE.md`), and the live API reference (`studiolab-api-documentation.md`). The two knowledge bases are complementary, not duplicative.

## Growth-specific conventions

- Never refer to GoHighLevel or "GHL" — always "StudioLAB Growth"
- Naming rules for Growth surfaces follow the global CLAUDE.md "StudioLAB Growth" convention
- US English in copy targeting US studios; Australian English by default
- Onboarding sequence work pairs with StudioLAB platform onboarding — coordinate so they don't diverge

## StudioLAB platform API reference

`/Users/gary/Claude_Projects/StudioLAB-Shared/studiolab-api-documentation.md` — full API contract for the live StudioLAB platform. Reference when Growth onboarding flows need to integrate with the platform (account creation, family setup, initial enrolment, etc.).
