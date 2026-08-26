# IN-FLIGHT: Growth Onboarding

Live state only; history in `IN-FLIGHT-HISTORY.md`. Verify against the live DB, not this file.
Last updated: 2026-08-26.

## WE HAVE A REAL PAYING STUDIO. The table is no longer empty.

Neverland (michelle@neverlandstudios.co.nz), submission `e6978e3f-d85d-4d43-b695-071d07dc0d98`,
paid **AUD 768.90** 2026-08-26 09:52 AEST for "Dominate AI, Done for you". Invoice `SLG-0204`, row
`submitted`/`paid`, receipt sent. She has NO Growth sub-account and NO plan subscription, and Stripe
told her the team would be in touch within a few business days. **That clock started 2026-08-26.**
She came to the form directly; the signup webhook is still inert. **Gary's call, do not
re-litigate: NO refund, NO recharge on the AUD/GST billed; handled in accounting.**

## The payment webhook was DEAD for 15 days. Fixed and now MONITORED 2026-08-26.

Our endpoint was deleted from the SHARED Stripe account ~2026-08-11; 649 events to that date, then
nothing, and Neverland's payment fell in the window. Now `we_1U8VYxCcwFH6sWzIYNEKgr57`, live.
**The account is shared and the dev team works in it, so this can recur.**

- `stripe-webhook-health` is SCHEDULED: job 7, `40 */6 * * *`, migration 050. PROVEN, the exact
  cron path returned `healthy:true`; unauthed and wrong-bearer POSTs 403.
- `stripe-webhook` live is **v49 (2026-05-18)**; `e4f8ce2` (unsubscribe link) landed 2 min after,
  so Michelle's receipt may lack it. Redeploy as its own slice.

## All five crons run now. The vault held PLACEHOLDER text for three months.

`studiolab_service_role_key` is the literal `YOUR-SERVICE-ROLE-KEY` (019's example lines run
verbatim, 2026-05-14), so `quote-reminders` and `cleanup-attachments` had NEVER reached a function:
pg_net logged "Couldn't resolve host name" while `cron.job_run_details` said 'succeeded'. No harm,
both tables were empty. 050/051 repointed every job at `studiolab_cron_secret`; all five proven with
a live 200, and nothing reads the service-role secret now. Migrations apply BY HAND here; `migration
list` Remote is empty for all 52, so `db push` would replay everything.

## The AU/US routing hole is CLOSED server-side (2026-08-26)

`create-checkout-session` runs `_shared/region-guard.ts`: blocks on POSITIVE contradicting evidence
only (international dial code, or a postcode that cannot be Australian), NEVER on absence, so a
legitimate AU studio is never stopped. Symmetric, catching AU-on-US-flow too. Blocks log as
`checkout_blocked_region_mismatch` (052 permits it). Proven on Neverland's exact stored values.
STILL OPEN: the PREVIEW (`resolve-pricing`) shows a NZ studio AUD all the way to checkout, where it
stops. `COUNTRY_TO_REGION` (`js/form.js:266`) is still dead code; the dropdown stays removed.

## Waiting on Gary

**The signup cutover, inside StudioLAB Growth. Still the go-live item.** `SIGNUP_WEBHOOK_SECRET`
rotated 2026-08-24; value in the Connector's gitignored `supabase/manual/.rotated-signup-secret`.
Remaining: audit every automation emailing on sub-account creation (KEEP the login-credentials
email, disable the welcome one), then flip both switches in one sitting. Pack:
`Growth Connector/docs/signup-email-cutover-pack.md` (PRIVATE repo).

**Silent-hold hazard.** An unmapped `plan`/`region` returns `200 {held:true}`, writes NO row and
sends NO email. Confirm an `invited` row in `inbound_signup` BEFORE switching anything off.

## Open decisions for Gary

- **Should a studio be able to change plan during onboarding?** Deliberately closed.
- **Stripe Tax**: `automatic_tax` is OFF in live; flat AU GST is applied on CURRENCY, not the
  studio's country. That is how a NZ business was charged AU GST. Accountant question.

## Known, deliberately NOT fixed

- Supabase JS SDK loads from a CDN at a floating major, no SRI/CSP, on the six form pages.
- `send-otp` has no per-IP cap: a link holder can mail a code every 60 seconds.

## Scenario B

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT** until cutover.
- **The match-at-Connect seam is not dead.** `conversation-bind` still resolves by an email guess.
