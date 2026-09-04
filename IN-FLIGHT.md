# IN-FLIGHT: Growth Onboarding

Live state only; history in `IN-FLIGHT-HISTORY.md`. Verify against the live DB, not this file.

## WE HAVE A REAL PAYING STUDIO. **Onboarding her is the oldest clock.**

One AU studio, paid in full 2026-08-26, `submitted`/`paid`, receipt sent. NO Growth
sub-account and NO plan subscription yet. **Clock started 2026-08-26. Gary's call, do
not re-litigate: NO refund, NO recharge.** Identifiers live in the DB only: repo is PUBLIC.

## Standing hazards (full detail in history)

- **The site publishes from `site/` ONLY** (Actions workflow, not branch root, since
  2026-09-04). Never repoint the workflow `path:` or set Pages back to a branch. CLAUDE.md.
- **The Stripe account is SHARED and the dev team works in it.** Our webhook was deleted there once
  and sat dead 15 days. `stripe-webhook-health` (cron 7) watches it. **CAN recur.**
- **Migrations apply BY HAND** (`supabase db query --linked -f`). Remote list is empty for all 54,
  so `db push` replays all of them against live.
- **Deploys do not run `deno check`.** `stripe-webhook` sat 3 months stale with 12 type errors,
  `get-studio-account` had 58 (a concatenated `.select()` defeats supabase-js typing: use ONE
  template literal). Run all three gate commands; #3 now parses all 25 client scripts.
- **`verify_jwt` is NOT app auth.** The gateway takes any valid project JWT and the PUBLIC key is
  in page source. Every function authenticates its own body.

## TWO LINES: Australia, and everyone else. COUNTRY is a separate axis.

Country arrives with the signup payload, so routing belongs THERE. `resolveFormRoute` knew only
au/us aliases; **everything else resolved to nothing and was HELD**. Now AU goes `au`, EVERYTHING
else `us`; only an unmappable `plan` holds (Connector `89a37e2`). Checkout is the backstop:
`pricingCountryFor` reprices direct arrivals SYMMETRICALLY from BOTH `resolve-pricing` and
`create-checkout-session`, so shown and charged cannot disagree (052).

**A UK studio pays on the everyone-else line AND is a UK business.** Form and `sms_a2p` tile key
their fields on COUNTRY (`_shared/business-identifiers.ts`, `_shared/sms-registration.ts`; 054,
form `?v=20260826c`). **Never erase what a studio gave us:** a field that stops applying is
OMITTED, never nulled. Messaging tiles STAGE behind the access pack, not `status='active'`.
Both shipped and verified; detail in history. Guided (DIY) removal PARKED.

## Waiting on Gary

**The signup cutover, inside StudioLAB Growth. Still the go-live item.** `SIGNUP_WEBHOOK_SECRET`
rotated 2026-08-24; value in the Connector's gitignored `supabase/manual/.rotated-signup-secret`.
Remaining: audit every automation emailing on sub-account creation (KEEP the login-credentials
email, disable the welcome one), then flip both switches in one sitting. Pack:
`Growth Connector/docs/signup-email-cutover-pack.md`. Confirm an `invited` row first.

## Open decisions for Gary

- **Stripe Tax**: `automatic_tax` is OFF in live; flat AU GST applies on CURRENCY, not the
  studio's country. That is how a NZ business got AU GST. Accountant question.

## Known, deliberately NOT fixed

- Supabase JS SDK loads from a CDN at a floating major, no SRI/CSP, on the six form pages.
- `send-otp` has no per-IP cap: a link holder can mail a code every 60s.
- `sync-to-sheet` 500s: `SHEETS_WEBAPP_URL`/`SHEETS_SHARED_SECRET` unset.
- A sole trader in AU or the UK holds no company number, so we ask for none. Real gap at Standard
  A2P. Canada's long-code A2P registry status is also unverified. Check both on a live account.

## Scenario B

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT** until cutover. Match-at-Connect is live;
  `conversation-bind` still resolves by email guess.
