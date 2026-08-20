# Onboarding pre-fill (Scenario B): build plan

Status: PLAN (2026-08-20). Tier-2 (identity binding + live production form). Spans two repos.
Decision: Gary, 2026-08-20, "pick up the information from them once they sign in ... they just
confirm it and then we step through and this is where they select and pay for their setup pricing."

Supersedes the F2/F3 sketch in the 2026-08-20 audit handover (see "Security sequencing" below for
why the client-side resolve was rejected).

## The load-bearing fact

**Both repos deploy to the same Supabase project: `hiaruvsdamggenhqdvtp`.**

Verified: `Growth - Onboarding/supabase/.temp/project-ref` and `Growth Connector/supabase/.temp/project-ref`
are byte-identical. This is the ratified two-layer model (Connector DECISIONS-HISTORY 2026-07-23,
"two layers of ONE platform sharing one database").

Consequence: the onboarding form's own Edge Functions can read `growth_manager.inbound_signup`
directly with the service role. There is **no HTTP call between the two projects, no shared API
surface, and no coupled deploys.** The two codebases stay separate and independent exactly as
Gary wants; they simply share the database that already holds the signup data.

This removes the "C2 token-resolve endpoint" from the critical path entirely. We do not need the
Connector to expose anything.

## What is already built (verified in code, not from docs)

| Piece | State | Evidence |
|---|---|---|
| Signup webhook receiver (C1) | **BUILT, green, deploy-gated on Gary** | `Growth Connector/supabase/functions/signup-webhook-receiver/` |
| `inbound_signup` table + pre-bind token | **BUILT** (migration 0006) | `location_id`, `contact_email`, `contact_first_name`, `contact_last_name`, `company_name`, `plan`, `region`, `tier`, `bind_token_hash` |
| Invite email pointing at the LIVE form | **BUILT** | `index.ts:41` + `email.test.ts:38` construct `https://app.studiolabgrowth.com/{au\|us}/{launch\|scale\|ai}?t=<token>` |
| Token mint + HMAC hash | **BUILT** | `index.ts` `mintToken` (32-byte hex, registered as a secret so it never reaches a log) + `hashToken` (HMAC with `PREBIND_TOKEN_PEPPER`) |
| Form hydrate of identity fields | **ALREADY WORKS** | `js/form.js` `hydrateFromSubmission` already maps `first_name`, `last_name`, `studio_name`, `contact_email` when present on the draft |
| `0009_resolve_prebind_token.sql` | **DEAD for this path** | It links a `capture_intake` row (the shelved new-form path), not the old form's `public.submissions`. Leave it shelved. |

The invite link is **already aimed at the live form**. The only missing half is the form end
picking the token up.

## The honest pre-fill ceiling

Gary's ask is "don't make the studio fill in more than they've already given us". Stating plainly
what that can and cannot reach, because the answer shapes the build.

### Tier 1: in hand today, zero new integration

`location_id`, `contact_email`, `first_name`, `last_name`, `company_name` (becomes `studio_name`),
`plan`, `region`, `tier`.

This is the entire "who are you" block. **Step 1 becomes a confirm screen**, which is precisely
the experience Gary described. This tier is the whole win for the least risk and should ship first.

### Tier 2: one new adapter verb, live read of the studio's own sub-account

Business address, phone, website, timezone, business email, possibly logo.

A GHL location detail record (`GET /locations/{id}`) carries these. The adapter today reads only
`id, name, country, timezone, status, isAgencySubAccount, dateAdded` from the location **list**
(`internal.ts:625-633`), and deliberately excludes address and phone as a PII-minimisation posture
for the operator console (`studios.ts:35`, `internal.ts:670`).

Reading a studio's **own** address to show back to **that studio** on **their own** onboarding form
is a materially different privacy case from an operator dashboard listing every studio, and is
defensible. But it is a deliberate posture change, so it needs a **new narrowly-scoped verb**
(`get_location_detail`, single location, studio-scoped), never a widening of the existing list read.

**VERIFIED 2026-08-20: the answer is no. Tier 2 is CANCELLED.** The adapter verb
(`get_location_detail`, ADR-0018) was built and run read-only against the live fleet (52 studio
sub-accounts, agency + 3 masters excluded). Per field:

| Field | Fill | Usable? |
|---|---|---|
| `email` (business) | 100% | **Yes**, the one reliable field |
| `country` | 100% | Yes, but tier 1 already carries `region` |
| `timezone` | 100% | **No: populated but WRONG.** 43/56 read `America/Los_Angeles` (the platform default), including every AU studio. Pre-filling it shows an Australian studio a Los Angeles timezone to "confirm" |
| `phone` | 63% | **No**, mostly sequential test numbers, and format is whatever was typed; only 9 of 33 are E.164 (`0414451533`, `+61 414 451 533`, `8956895208`, `+1 555 123 4567`) |
| `website` | 44% | **No**. 20 of the 24 values are the identical placeholder `https://theonetechnologies.com/`. Real fill is 4 of 52 |
| `address` / `city` / `state` / `postalCode` | 13-17% | **No**. 7 of 52 carry an address; only three are real (all typed in by hand after signup). The rest is junk (`address: "1"`, `address: "New York"` + `postalCode: "45654"`) |

The *schema* is fine: the address is properly split into street/city/state/postcode/country, not
a free-text blob, so it would map cleanly to form boxes. The data is simply absent, because
**signup never asks for it**. These fields populate only when someone later opens the
sub-account's business profile and types them.

So pre-filling the address block would show most studios empty boxes, a minority junk to correct,
and an actively wrong timezone. "Confirm rather than type" holds for the tier-1 identity block
only, which is where the whole win already was.

**What would change the answer:** if signup is ever changed to collect the studio address, the
data becomes good immediately (the schema is already right), and the verb is already built,
reviewed and green, so tier 2 would become a deploy plus a form change, not a new build.

### Tier 3: does not exist anywhere, must be asked

Branding colours, logo, studio description, email voice/tone/sign-off, legal and tax IDs
(ABN/ACN/EIN/SSN), custom domain, SMS intent, send-on-behalf consent, public listing links.

Branding custom values were verified **provably empty fleet-wide** (Connector B2 scan, recorded
2026-07-23). No amount of integration surfaces these. They are the "make it yours" content the
form exists to collect.

**Net:** pre-fill removes the "who are you" boxes and (pending the tier-2 check) most of the
"where are you" boxes. Branding, voice, legal and consent stay real asks. Payment stays terminal
and unchanged.

## Security sequencing (tech-lead call, supersedes the handover sketch)

The prior sketch had the form read `?t=`, resolve identity **client-side**, and stamp `location_id`
from the browser. **Rejected**, for two reasons:

1. The raw token is a bearer credential sitting in an email inbox. A client-side resolve means any
   forwarded or leaked link discloses the studio's name, email and company to whoever holds it.
2. A client-stamped `location_id` is trivially forgeable, and it would corrupt the binding that
   `promote_verified_capture()` (migration 0007) depends on.

**The token must never unlock data in the browser.** It travels to the server, and the server does
everything. Corrected flow:

1. Studio signs up in GHL. Sub-account is created, signup automation fires the webhook.
2. C1 records `inbound_signup`, mints the token, emails the link `…/{region}/{plan}?t=TOKEN`.
3. Studio opens the link. The form reads `?t=` into memory only (never `localStorage`, never a log,
   never a query echoed into an error) and calls `send-otp` with `{ t }` instead of a typed email.
4. `send-otp` HMACs the token, looks up `bind_token_hash`, resolves `contact_email`, and sends the
   OTP **to that address**. The studio never types their email. The screen shows only a masked
   hint, for example "we sent a code to s•••@yourstudio.com".
5. Studio enters the code. Form calls `verify-otp` with `{ code, t }`.
6. `verify-otp` verifies the OTP as it does today, re-resolves the token server-side, and seeds the
   draft `submissions` row with the tier-1 identity **plus `location_id`, stamped server-side**.
7. The form hydrates from the draft. `hydrateFromSubmission` already handles these fields.

Worst case for a leaked link under this design: an OTP code is mailed to the legitimate studio's
own inbox. No identity disclosure, no forged binding.

**Bonus:** because the existing hydrate path already maps these columns, the client-side work is
small. The real work is server-side, which is also where it belongs.

## Work breakdown

### Onboarding repo (this one)

1. **Migration**: add `location_id text` to `public.submissions` plus an index. Additive, so
   contract-safe under the Connector read allow-list.
2. **`supabase/functions/_shared/prebind.ts`** (new): HMAC the raw token with `PREBIND_TOKEN_PEPPER`
   and look up `growth_manager.inbound_signup`. Fail closed on no match. Shared by both functions
   below so the resolve logic exists exactly once.
3. **`send-otp`**: accept an optional `t`. When present, resolve the email server-side rather than
   trusting a client-supplied address. Rate-limit by token.
4. **`verify-otp`**: accept an optional `t`. After the OTP passes, seed or update the draft with the
   tier-1 identity and stamp `location_id`.
5. **`js/form.js`**: capture `?t=` from the URL, pass it through to both calls, render the masked
   email hint, and restore confident step-1 copy (the softened line shipped in `138f382` is correct
   only until this lands).

### Connector repo

6. **Deploy C1.** Already built and green, gated on Gary. Nothing else is required for tier 1.

### Gary's GHL configuration

7. Point the signup automation's webhook at the deployed `signup-webhook-receiver`, with the shared
   secret.
8. **Disable the platform's own onboarding email**, so studios receive exactly one email (ours,
   carrying the pre-bound link). Two emails with two different links is the main way this goes
   wrong in production.

### Tier 2: CANCELLED (data check failed, 2026-08-20)

9. ~~New scoped adapter verb `get_location_detail`, plus a top-up of the address block during
   `verify-otp`.~~ The verb is BUILT, green and committed (Connector ADR-0018) but **NOT deployed**
   and has no consumer; the address-block top-up is not being built. See the tier-2 table above.

## Sequencing

Steps 1 to 5 are one coherent slice and should be built and reviewed together. Step 6 (deploy C1)
and steps 7 to 8 (GHL config) must land **before** step 5 is useful in production, but they do not
block building it.

Ship order: current audit work (slices A to C in the handover) reaches production first, since the
form is going live now and pre-fill is an enhancement on top of a working form. Pre-fill follows as
its own Tier-2 slice with full adversary review, since it touches identity binding.

## Open items for Gary

- ~~**Tier-2 data check**: do two or three real sub-accounts actually carry address, phone and
  website?~~ **DONE 2026-08-20: no.** Ran fleet-wide, not just two or three. Tier 2 cancelled;
  detail in the tier-2 section above and in Connector `DECISIONS-HISTORY.md` (ADR-0018).
- **Deploy authority**: C1's deploy and the prod writes in the existing runbook are both gated by
  the harness safety classifier. Either grant Bash permission for `supabase functions deploy` and
  `supabase db query --linked`, or run them yourself from the runbook.

## Canon updates owed when this ships

- Connector `docs/DECISIONS-HISTORY.md`: record that pre-fill resolves **server-side against the
  shared database**, and that the separate C2 resolve endpoint is not being built.
- Same file: record the socials reconciliation already shipped in `138f382` (the 2026-06-20
  retirement stands; the 2026-07-23 reversal argued from pre-fill capability and never rebutted
  the original rationale, which was that a pasted handle is not an OAuth connection).

---

# EXECUTION PLAN (tier 1 pre-fill) — added 2026-08-20 on Gary's go

**Status: GO GIVEN**, after Gary ran the invite link end to end and hit exactly the experience this
plan predicts: a generic form, his email retyped, an OTP, then a blank step 1.

**Tier 2.** Touches auth and identity (the OTP entry path), adds schema in two repos, and changes
which side of the wire decides a studio's plan. Full pipeline, no shortcut.
**Charging-model gate: not applicable.** No charge, payment, credit, refund, invoice, billing
period, balance or payment plan is touched. `submissions` carries payment columns; this slice does
not read or write one.

## Live state, verified 2026-08-20 against the database and the code, not the docs

- `app.studiolabgrowth.com/{region}/{plan}?t=<token>` is what C1 actually emails
  (`buildInviteUrl`, Connector `signup-webhook-receiver/lib/email.ts`). The token is real and the
  route resolves; Gary's run-through proved both.
- **`js/form.js` reads only `plan`, `region` and `preview`.** It never looks at `t`. That single
  fact is the whole defect.
- **`send-otp` accepts `{ email }` and nothing else.** No token, no identity.
- **No `prebind.ts` exists** anywhere in this repo.
- **`public.submissions` has NO `location_id` column.** It does have `studio_name`, `first_name`,
  `last_name`, `contact_email`, `plan`, `region`, so everything else tier 1 needs already has a home.
- **`growth_manager.inbound_signup` is live and populated** with `location_id`, `contact_email`,
  `contact_first_name`, `contact_last_name`, `company_name`, `plan`, `region`, `tier`, and
  `bind_token_hash` carries a UNIQUE index (`inbound_signup_token_idx`), so a lookup by hash is an
  index hit, not a scan.
- **`growth_manager.resolve_prebind_token` does NOT exist live**, and the version in Connector
  migration 0009 is the wrong shape anyway: it takes `(p_intake_id uuid, p_bind_token_hash text)`
  and is built around the shelved `capture_intake`. A new function is needed, under a new name.
- Live `growth_manager` functions confirmed: `record_inbound_signup`, `mark_inbound_invited`,
  `get_signup_secret`, `get_adapter_secret`, and the read/conversation set. Nothing else.
- `hydrateFromSubmission` already maps `studioName`, `firstName` and `lastName` from the returned
  submission, so seeding the draft server-side pre-fills the form with no new client mapping.

## The design decision this slice makes, and where it departs from the plan above

**The pepper never leaves the database.** The design above has `_shared/prebind.ts` read
`PREBIND_TOKEN_PEPPER` and compute the HMAC inside the Edge Function. That works, but it spreads the
pepper to two more public, anon-callable functions, and `send-otp` / `verify-otp` are exactly the
kind of internet-facing surface the C1c secret-scope doctrine says to keep credentials away from.

Instead, a single SECURITY DEFINER RPC takes the RAW token and does the HMAC **inside Postgres**,
reading the pepper from the vault in the same transaction and returning only the tier-1 identity.
Verified this is possible before choosing it: `extensions.hmac(text, text, 'sha256')` produces
byte-identical output to the Web Crypto HMAC-SHA256 the receiver mints with, checked against a Node
reference (`9f8788cb…83d8` from both). So the hashes match by construction, and neither OTP function
ever holds a credential. `_shared/prebind.ts` becomes a thin, testable caller instead of a crypto
module.

**The token, not the URL, decides plan and region.** Today `verify-otp` takes `plan` and `region`
from the client, so a studio can edit the URL and self-select a different plan. When a token is
present the server uses the plan and region stored against the signup and ignores what the browser
sent. The stored vocabulary (`launch` / `scale` / `dominate-ai`) is mapped to the form's
(`launch` / `scale` / `ai`) with the same mapping the Connector's `resolveFormRoute` uses.

**An existing draft is never clobbered.** Seeding fills only fields that are empty. A studio who has
already typed a different trading name keeps it.

## Business rules in scope (cited, so the adversary has something concrete)

- **BR1 — the token must never unlock data in the browser.** It is a bearer credential sitting in an
  inbox. The raw token goes to the server; the server resolves. A forwarded link must disclose
  nothing: worst case is an OTP mailed to the legitimate studio's own address. Source: the "Security
  sequencing" section above.
- **BR2 — `location_id` is stamped server-side only.** A client-supplied binding key is forgeable and
  would corrupt what `promote_verified_capture()` (Connector 0007) depends on. Source: same section.
- **BR3 — OTP verification is NOT bypassed by holding a token.** The token removes typing, not
  verification.
- **BR4 — no credential in a public function.** Public, anon-callable functions read no secret they
  do not need. Source: `docs/DECISIONS.md` (Connector), "Vault secret-scope doctrine".
- **BR5 — the form still asks for what StudioLAB does not already hold.** Address, phone, website and
  business email stay mandatory and are NOT pre-filled: the platform's copies are optional, not
  format-guaranteed, and the tier-2 check on 2026-08-20 found them mostly absent or junk. Source:
  `IN-FLIGHT.md` "Next slices" 1, and Connector ADR-0018.
- **BR6 — never DDL another repo's schema.** `growth_manager` objects go in the Connector repo's
  migrations; `public.submissions` goes here. Source: Connector `supabase/migrations/README.md` rule 5.

## Success criteria

1. Connector migration declaring `growth_manager.resolve_signup_by_token(p_raw_token text)`:
   SECURITY DEFINER, `search_path = ''`, HMACs the raw token with the vault pepper, looks up
   `inbound_signup` by `bind_token_hash`, returns ONLY tier-1 identity, returns no row on no match,
   raises if the pepper is absent, revoked from public/anon/authenticated, granted to service_role.
2. Onboarding migration adding `location_id text` to `public.submissions`, additive and idempotent,
   plus an index.
3. `_shared/prebind.ts`: resolves a raw token through the RPC, fails closed, maps the stored plan
   vocabulary to the form's, and never logs or echoes the token.
4. `send-otp` accepts an optional `t`. With a token it resolves the address server-side, ignores any
   client-supplied email, throttles by token, and returns only a MASKED hint.
5. `verify-otp` accepts an optional `t`. After the OTP passes it re-resolves server-side, seeds the
   draft with tier-1 identity, stamps `location_id`, and takes plan and region from the token. It
   never overwrites a non-empty field.
6. `js/form.js` reads `?t=` into memory only (never `localStorage`, never a log, never echoed into an
   error), passes it to both calls, and shows the masked hint instead of an email input.
7. Tests covering: fail-closed on an unknown/absent/malformed token, no-clobber on an existing draft,
   the plan-vocabulary mapping, and that a client-supplied email or plan cannot override the token.
8. Canon updated in the same change: both repos' `IN-FLIGHT.md`, this plan, and a decision entry.
9. Green gate in both repos.

## Out of scope, deliberately

Tier 2 (address / phone / website pre-fill) stays CANCELLED on its own evidence. Studio-specific
branding of the form is not possible: the ADR-0018 fleet scan found zero branding custom values
anywhere. Skipping the OTP is refused, see BR3.

---

## OUTCOME (2026-08-20) — built, reviewed, green, not deployed

**Two design decisions this slice made, both departures from the sketch above.**

1. **The HMAC moved into Postgres.** `_shared/prebind.ts` was going to read `PREBIND_TOKEN_PEPPER`
   and hash the token itself. Instead `growth_manager.resolve_signup_by_token` does it inside a
   SECURITY DEFINER function, so `send-otp` and `verify-otp` hold no pepper. Verified first that
   `extensions.hmac` matches the receiver's Web Crypto HMAC byte for byte.
2. **The masked email hint was dropped, not shown.** The sketch specified
   "we sent a code to s•••@yourstudio.com". The domain is usually the studio's brand, so the hint
   tells whoever holds a forwarded link exactly whose token it is - which is what the security
   sequencing section above forbids. The screen now says "the email address on your account".

**Two pre-existing defects the panel found, neither introduced here, both closed in this slice
because they sit on the code it touches.**

- **A LIKE-injection on every email lookup.** `.ilike()` on a client-supplied address, where `%`
  and `_` are wildcards the email validator accepted. An unauthenticated caller could request a
  code for their own address, then post `email: '%@%.%'` with that code: the OTP lookup matched
  every live row, their own hash satisfied the check, and generic mode returned every submission in
  the table. A pattern matching their own mailbox plus exactly one victim returned that victim's
  full row and a 90-day session token. Fixed by `.eq()` at all eight call sites, after verifying
  production has zero mixed-case rows so the change is behaviour-preserving.
- **Plan was client-writable and drives pricing.** `save-draft` accepted `plan`, the form sent it
  from the URL on every autosave, and `create-checkout-session` prices off it. Removed from the
  allow-list.

**Open for Gary, not decided here:** whether a studio should be able to change plan during
onboarding at all. It is now server-decided; making it changeable again needs a deliberate path.

**Deliberately not fixed, recorded rather than carried silently:** the Supabase SDK loads from a CDN
at a floating major version with no SRI and no CSP on the six form pages; `send-otp` has no per-IP
cap, so a link holder can mail a studio a code every 60 seconds indefinitely.

**Green.** Connector: typecheck clean, 1071 vitest across 78 files. Onboarding: `deno check` clean
on all changed functions, 19 `deno test` cases, `node --check` on `form.js`. This repo had no test
framework and no documented gate before this slice; both now exist, and the gate is in `CLAUDE.md`.
