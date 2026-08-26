# IN-FLIGHT: Growth Onboarding

Live state only; history in `IN-FLIGHT-HISTORY.md`. Verify against the live DB, not this file.

## WE HAVE A REAL PAYING STUDIO. The table is no longer empty.

Neverland, submission `e6978e3f-d85d-4d43-b695-071d07dc0d98`, paid **AUD 768.90** 2026-08-26 for
"Dominate AI, Done for you". Invoice `SLG-0204`, row `submitted`/`paid`, receipt sent. NO Growth
sub-account and NO plan subscription yet; Stripe told her the team would be in touch within a few
business days, so **that clock started 2026-08-26.** She came to the form directly. **Gary's call,
do not re-litigate: NO refund, NO recharge on the AUD/GST billed; handled in accounting.**

## The payment webhook was DEAD for 15 days. Fixed and now MONITORED 2026-08-26.

Deleted from the SHARED Stripe account ~2026-08-11; Neverland's payment fell in the window. Now
`we_1U8VYxCcwFH6sWzIYNEKgr57`, live. **Account is shared and the dev team works in it, so this can
recur.** `stripe-webhook-health` SCHEDULED (job 7, `40 */6 * * *`, 050), PROVEN `healthy:true`;
unauthed POSTs 403. `stripe-webhook` REDEPLOYED to **v52**: v51 predated `e4f8ce2` by 66s and ran 3
months stale, so this landed 9 commits of drift, and its 12 type errors are fixed (never
type-checked before). Gateway re-probed after both.

## All five crons run now. The vault held PLACEHOLDER text for three months.

`studiolab_service_role_key` is the literal `YOUR-SERVICE-ROLE-KEY` (019's example lines run
verbatim, 2026-05-14), so `quote-reminders` and `cleanup-attachments` had NEVER reached a function:
pg_net logged "Couldn't resolve host name" while `cron.job_run_details` said 'succeeded'. No harm,
both were empty. 050/051 repointed every job at `studiolab_cron_secret`; all five proven live.
Migrations apply BY HAND; `migration list` Remote is empty, so `db push` replays all.

## TWO LINES: Australia, and everyone else. Routing fixed at the SIGNUP seam.

Country arrives with the signup API payload, so routing belongs THERE, not at checkout. Connector
`resolveFormRoute` knew only au/us aliases; **everything else resolved to nothing and was HELD** (no
row, no invite, no email), so a NZ studio would sign up, pay and get silence. Now AU aliases go
`au`, EVERYTHING else `us`; region can never hold, only an unmappable `plan` can. Fallbacks log via
`regionSource`. Deployed + probed (Connector `89a37e2`).

Backstop for a direct-link arrival, now SYMMETRIC and CLOSED end to end. The AUD/USD catalogs are
independently priced (AI/DFY: AUD 699 vs USD 549), so a crossing is the wrong price list, not a
bigger bill. `pricingCountryFor` corrects BOTH ways, and BOTH `resolve-pricing` (preview, via
`session_token`) and `create-checkout-session` call it, so shown and charged price cannot disagree.
Logged `checkout_region_repriced` (052).

## Waiting on Gary

**The signup cutover, inside StudioLAB Growth. Still the go-live item.** `SIGNUP_WEBHOOK_SECRET`
rotated 2026-08-24; value in the Connector's gitignored `supabase/manual/.rotated-signup-secret`.
Remaining: audit every automation emailing on sub-account creation (KEEP the login-credentials
email, disable the welcome one), then flip both switches in one sitting. Pack:
`Growth Connector/docs/signup-email-cutover-pack.md`.

**Silent hold is now PLAN ONLY** (region routes to `us`, see above). An unmappable `plan` still
returns `200 {held:true}`, NO row, NO email. Confirm an `invited` row BEFORE switching off.

## Open decisions for Gary

- **Change plan during onboarding?** Deliberately closed.
- **Stripe Tax**: `automatic_tax` is OFF in live; flat AU GST applies on CURRENCY, not the
  studio's country. That is how a NZ business got AU GST. Accountant question.

## Known, deliberately NOT fixed

- Supabase JS SDK loads from a CDN at a floating major, no SRI/CSP, on the six form pages.
- `send-otp` has no per-IP cap: a link holder can mail a code every 60 seconds.

## Scenario B

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT** until cutover.
- **The match-at-Connect seam is live.** `conversation-bind` still resolves by an email guess.
