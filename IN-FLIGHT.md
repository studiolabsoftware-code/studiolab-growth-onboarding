# IN-FLIGHT: Growth Onboarding

Live state only; history in `IN-FLIGHT-HISTORY.md`. Verify against the live DB, not this file.

## WE HAVE A REAL PAYING STUDIO. **Onboarding her is the oldest clock.**

Neverland, submission `e6978e3f-...`, paid **AUD 768.90** 2026-08-26, invoice `SLG-0204`, row
`submitted`/`paid`, receipt sent. NO Growth sub-account and NO plan subscription yet; Stripe said
the team would be in touch within a few business days, so **that clock started 2026-08-26.**
**Gary's call, do not re-litigate: NO refund, NO recharge on the AUD/GST billed.**

## Fixed and verified 2026-08-26 (detail in history)

- **Payment webhook** was dead 15 days (endpoint deleted from the SHARED Stripe account). Replaced
  and now watched by `stripe-webhook-health`, cron job 7, `40 */6 * * *` (050). **The account is
  shared and the dev team works in it, so this CAN recur.**
- **All five crons run.** Both vault secrets held 019's PLACEHOLDER text, so `quote-reminders` and
  `cleanup-attachments` had NEVER reached a function. 050/051 repointed them at
  `studiolab_cron_secret`.
- **`stripe-webhook` is v52.** v51 ran 3 months stale; its 12 type errors are fixed (never
  type-checked, since deploys do not run `deno check`).
- **An OPEN EMAIL RELAY is closed** (053). `on-submission` / `sync-to-sheet` /
  `notify-new-message` had ZERO app auth: `verify_jwt` is not auth here, the gateway takes any
  valid project JWT and the PUBLIC key ships in page source, so anyone could POST a forged `record`
  and `on-submission` mailed `row.contact_email` from our domain. All three now require
  CRON_SECRET, read from Vault by `notify_edge_function()`.
- **Migrations apply BY HAND.** `migration list` Remote is empty for all 53, so `db push` would
  replay everything.

## TWO LINES: Australia, and everyone else. COUNTRY is a separate axis.

Country arrives with the signup API payload, so routing belongs THERE. `resolveFormRoute` knew only
au/us aliases; **everything else resolved to nothing and was HELD** (no row, no invite, no email).
Now AU goes `au`, EVERYTHING else `us`; only an unmappable `plan` can hold (Connector `89a37e2`).
Checkout is a backstop: `pricingCountryFor` reprices direct-link arrivals SYMMETRICALLY, and BOTH
`resolve-pricing` (via `session_token`) and `create-checkout-session` call it, so shown and charged
price cannot disagree (052).

**A UK studio pays on the everyone-else line AND is a UK business.**
`_shared/business-identifiers.ts` maps country to the identifier it issues (AU ABN+ACN, US EIN, NZ
NZBN, UK CRN, CA BN, generic); prebind keeps `identity.country`. **NOT YET CONSUMED: the form still
shows only EIN/ABN/ACN gated on AU/US, so NZ/UK/CA studios are asked for NO identifier and SMS
registration has nothing to submit.** Next slice.

## Waiting on Gary

**The signup cutover, inside StudioLAB Growth. Still the go-live item.** `SIGNUP_WEBHOOK_SECRET`
rotated 2026-08-24; value in the Connector's gitignored `supabase/manual/.rotated-signup-secret`.
Remaining: audit every automation emailing on sub-account creation (KEEP the login-credentials
email, disable the welcome one), then flip both switches in one sitting. Pack:
`Growth Connector/docs/signup-email-cutover-pack.md`. **Silent hold is now PLAN ONLY**: an
unmappable `plan` returns `200 {held:true}`, NO row, NO email. Confirm an `invited` row first.

## Open decisions for Gary

- **Change plan during onboarding?** Closed.
- **Stripe Tax**: `automatic_tax` is OFF in live; flat AU GST applies on CURRENCY, not the
  studio's country. That is how a NZ business got AU GST. Accountant question.

## Known, deliberately NOT fixed

- Supabase JS SDK loads from a CDN at a floating major, no SRI/CSP, on the six form pages.
- `send-otp` has no per-IP cap: a link holder can mail a code every 60 seconds.
- `sync-to-sheet` 500s: `SHEETS_WEBAPP_URL`/`SHEETS_SHARED_SECRET` unset. Non-draft rows only.

## Scenario B

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT** until cutover.
- **Match-at-Connect seam is live.** `conversation-bind` still resolves by an email guess.
