# IN-FLIGHT: Growth Onboarding

Live state only; history in `IN-FLIGHT-HISTORY.md`. Verify against the live DB, not this file.

## WE HAVE A REAL PAYING STUDIO. **Onboarding her is the oldest clock.**

Neverland, submission `e6978e3f-...`, paid **AUD 768.90** 2026-08-26, invoice `SLG-0204`, row
`submitted`/`paid`, receipt sent. NO Growth sub-account and NO plan subscription yet. **That clock
started 2026-08-26. Gary's call, do not re-litigate: NO refund, NO recharge on the AUD/GST.**

## Standing hazards (full detail in history)

- **The Stripe account is SHARED and the dev team works in it.** Our webhook was deleted there once
  and sat dead 15 days. `stripe-webhook-health` (cron 7) watches it. **This CAN recur.**
- **Migrations apply BY HAND** (`supabase db query --linked -f`). Remote list is empty for all 54,
  so `db push` replays every one against live.
- **Deploys do not run `deno check`.** That is how `stripe-webhook` sat 3 months stale with 12 type
  errors, and why `CLAUDE.md`'s gate is three commands. Run all three.
- **`verify_jwt` is NOT app auth.** The gateway takes any valid project JWT and the PUBLIC key is
  in page source. Every function authenticates its own body; keep it that way.

## TWO LINES: Australia, and everyone else. COUNTRY is a separate axis.

Country arrives with the signup payload, so routing belongs THERE. `resolveFormRoute` knew only
au/us aliases; **everything else resolved to nothing and was HELD** (no row, no invite, no email).
Now AU goes `au`, EVERYTHING else `us`; only an unmappable `plan` holds (Connector `89a37e2`).
Checkout is the backstop: `pricingCountryFor` reprices direct arrivals SYMMETRICALLY and BOTH
`resolve-pricing` and `create-checkout-session` call it, so shown and charged cannot disagree (052).

**A UK studio pays on the everyone-else line AND is a UK business.** The form now renders
identifier fields AND entity types from `_shared/business-identifiers.ts`, keyed on COUNTRY (054
adds `nzbn`/`crn`/`bn`/`tax_id`; save-draft deployed; `?v=20260826c`). Country resolves row → dial
code → URL; the US pages' select is a MIRROR, never the answer (it pre-filled `US` and beat the
row, which would have made the fix a no-op there). Two source-reading tests hold form.js and the
Deno module in step. Identifiers are OPTIONAL now, matching the on-page copy, and one that stops
applying is OMITTED, never nulled: we never erase what a studio gave us, so a stale ACN can outlive
a switch to sole trader.

**NEXT, same class:** the `sms_a2p` tile frames everything in US terms for every studio. Then
Gary's staged hold: keep 041's slice C (`sms_a2p`, `whatsapp`) back until the account is live.
Removing the Guided (DIY) path is PARKED.

## Waiting on Gary

**The signup cutover, inside StudioLAB Growth. Still the go-live item.** `SIGNUP_WEBHOOK_SECRET`
rotated 2026-08-24; value in the Connector's gitignored `supabase/manual/.rotated-signup-secret`.
Remaining: audit every automation emailing on sub-account creation (KEEP the login-credentials
email, disable the welcome one), then flip both switches in one sitting. Pack:
`Growth Connector/docs/signup-email-cutover-pack.md`. **Silent hold is PLAN ONLY** now: an
unmappable `plan` returns `200 {held:true}`. Confirm an `invited` row first.

## Open decisions for Gary

- **Stripe Tax**: `automatic_tax` is OFF in live; flat AU GST applies on CURRENCY, not the
  studio's country. That is how a NZ business got AU GST. Accountant question.

## Known, deliberately NOT fixed

- Supabase JS SDK loads from a CDN at a floating major, no SRI/CSP, on the six form pages.
- `send-otp` has no per-IP cap: a link holder can mail a code every 60s.
- `sync-to-sheet` 500s: `SHEETS_WEBAPP_URL`/`SHEETS_SHARED_SECRET` unset. Non-draft only.
- A sole trader in AU or the UK holds no company number, so we ask for none. Real gap at Standard
  A2P; check it against a live account rather than searching.

## Scenario B

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT** until cutover. Match-at-Connect is live;
  `conversation-bind` still resolves by an email guess.
