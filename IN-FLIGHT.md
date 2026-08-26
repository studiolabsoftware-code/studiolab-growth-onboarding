# IN-FLIGHT: Growth Onboarding

Live state only; history in `IN-FLIGHT-HISTORY.md`. Verify against the live DB, not this file.

## WE HAVE A REAL PAYING STUDIO. **Onboarding her is the oldest clock.**

Neverland, submission `e6978e3f-...`, paid **AUD 768.90** 2026-08-26, invoice `SLG-0204`, row
`submitted`/`paid`, receipt sent. NO Growth sub-account and NO plan subscription yet; Stripe said
the team would be in touch within a few business days, so **that clock started 2026-08-26.**
**Gary's call, do not re-litigate: NO refund, NO recharge on the AUD/GST billed.**

## Webhook was DEAD 15 days. Fixed + MONITORED. All five crons run now.

Endpoint deleted from the SHARED Stripe account ~2026-08-11; Neverland's payment fell in the window.
Now `we_1U8VYxCcwFH6sWzIYNEKgr57`, watched by `stripe-webhook-health` on cron job 7 (`40 */6 * * *`,
050), proven `healthy:true`. **The account is shared and the dev team works in it, so this can
recur.** `stripe-webhook` is v52; v51 ran 3 months stale and its 12 type errors are fixed (it had
never been type-checked). Both vault secrets held 019's PLACEHOLDER text from 2026-05-14, so
`quote-reminders` and `cleanup-attachments` had NEVER run; 050/051 repointed every job at
`studiolab_cron_secret`. **Migrations apply BY HAND; `migration list` Remote is empty, so `db push`
replays all.**

## TWO LINES: Australia, and everyone else. Routing fixed at the SIGNUP seam.

Country arrives with the signup API payload, so routing belongs THERE. Connector `resolveFormRoute`
knew only au/us aliases; **everything else resolved to nothing and was HELD** (no row, no invite, no
email), so a NZ studio would sign up, pay and get silence. Now AU goes `au`, EVERYTHING else `us`;
region can never hold, only an unmappable `plan` can (Connector `89a37e2`).

Backstop for direct-link arrivals, SYMMETRIC and closed end to end. AUD/USD catalogs are priced
independently (AI/DFY 699 vs 549), so a crossing is the wrong price list, not a bigger bill. BOTH
`resolve-pricing` (via `session_token`) and `create-checkout-session` call `pricingCountryFor`, so
shown and charged price cannot disagree. Logged `checkout_region_repriced` (052).

## Trigger targets had NO auth: one was an OPEN EMAIL RELAY. Fixed 2026-08-26 (053).

`on-submission` / `sync-to-sheet` / `notify-new-message` had zero app auth. `verify_jwt` is not auth
here: the gateway takes any valid project JWT and the PUBLIC key ships in page source, so anyone
could POST a forged `record` and `on-submission` mailed `row.contact_email` from our own domain. All
three now require CRON_SECRET; triggers read it from Vault via `notify_edge_function()`. No token in
any trigger def. Forged POSTs 401, real path 200, both triggers fire on a draft row.

## Waiting on Gary

**The signup cutover, inside StudioLAB Growth. Still the go-live item.** `SIGNUP_WEBHOOK_SECRET`
rotated 2026-08-24; value in the Connector's gitignored `supabase/manual/.rotated-signup-secret`.
Remaining: audit every automation emailing on sub-account creation (KEEP the login-credentials
email, disable the welcome one), then flip both switches in one sitting. Pack:
`Growth Connector/docs/signup-email-cutover-pack.md`. **Silent hold is now PLAN ONLY** (region
routes to `us`): an unmappable `plan` returns `200 {held:true}`, NO row, NO email. Confirm an
`invited` row BEFORE switching off.

## Open decisions for Gary

- **Change plan during onboarding?** Deliberately closed.
- **Stripe Tax**: `automatic_tax` is OFF in live; flat AU GST applies on CURRENCY, not the
  studio's country. That is how a NZ business got AU GST. Accountant question.

## Known, deliberately NOT fixed

- Supabase JS SDK loads from a CDN at a floating major, no SRI/CSP, on the six form pages.
- `send-otp` has no per-IP cap: a link holder can mail a code every 60 seconds.
- `sync-to-sheet` 500s: `SHEETS_WEBAPP_URL`/`SHEETS_SHARED_SECRET` unset. Non-draft rows only.

## Scenario B

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT** until cutover.
- **Match-at-Connect seam is live.** `conversation-bind` still resolves by an email guess.
