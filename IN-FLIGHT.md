# IN-FLIGHT: Growth Onboarding

Live state only; history in `IN-FLIGHT-HISTORY.md`. Verify against the live database, not this
file. Last updated: 2026-08-26.

## WE HAVE A REAL PAYING STUDIO. The table is no longer empty.

Neverland (michelle@neverlandstudios.co.nz), submission `e6978e3f-d85d-4d43-b695-071d07dc0d98`,
paid **AUD 768.90** 2026-08-26 09:52 AEST for "Dominate AI, Done for you". Invoice `SLG-0204`. Row
is `submitted`/`paid`, receipt sent. She has NO Growth sub-account and NO plan subscription, and
Stripe told her the team would be in touch within a few business days. **That clock started
2026-08-26.** She reached the form directly; the signup webhook is still inert.

## The payment webhook was DEAD for 15 days. Fixed and now MONITORED 2026-08-26.

Our endpoint was deleted from the SHARED Stripe account ~2026-08-11; 649 events to that date, then
nothing. Neverland's payment fell in the window. Now `we_1U8VYxCcwFH6sWzIYNEKgr57`, live, proven by
replay. **The account is shared and the dev team works in it. This can recur.**

- `stripe-webhook-health` is SCHEDULED: cron job 7, `40 */6 * * *`, migration 050. PROVEN, the
  exact cron path returned `healthy:true`; unauthed and wrong-bearer POSTs 403.
- `stripe-webhook` live is **v49 (2026-05-18)**; commit `e4f8ce2` (unsubscribe link) landed 2 min
  after. Michelle's receipt may lack it. Redeploy as its own slice.

## Two MORE crons are dead: the vault holds PLACEHOLDER text

`studiolab_service_role_key` is the literal `YOUR-SERVICE-ROLE-KEY` (019's example lines were run
verbatim, 2026-05-14). So `quote-reminders-daily` and `cleanup-attachments-daily` have NEVER reached
a function: pg_net logs "Couldn't resolve host name" while `cron.job_run_details` says 'succeeded'.
No harm yet: `quotes` and `submission_attachments` are empty. 050 fixed the URL and added
`studiolab_cron_secret`. **Next: repoint both at CRON_SECRET (code change + redeploy).** Migrations
apply BY HAND here; `migration list` Remote is empty for all 50, so `db push` replays everything.

## The AU/US routing hole is OPEN

`COUNTRY_TO_REGION` (`js/form.js:266`) maps NZ/CA/UK to the US route and is **dead code, never
read**: the country field was removed, so any studio on `/au/` is hard-set `country='AU'` and priced
AUD +10% GST. Michelle is in Auckland; her `+64` phone was in the submission before checkout and
nothing looked at it. `create-checkout-session` blocks an Australian on the US form
(`au_must_use_au_flow`) but has NO mirror guard. Build that server-side mirror, NOT a restored
dropdown, and block only on a POSITIVE non-AU signal (dial code, non-4-digit postcode), never on
absence. Gary is holding on Neverland commercially: no refund, no recharge.

## Waiting on Gary

**The signup cutover, inside StudioLAB Growth. Still the go-live item.** `SIGNUP_WEBHOOK_SECRET`
rotated 2026-08-24; value in the Connector's gitignored `supabase/manual/.rotated-signup-secret`.
Remaining: audit every automation emailing on sub-account creation (KEEP the login-credentials
email, disable the welcome one), then flip both switches in one sitting. Pack:
`Growth Connector/docs/signup-email-cutover-pack.md` (PRIVATE repo).

**Silent-hold hazard.** An unmapped `plan`/`region` returns `200 {held:true}`, writes NO row and
sends NO email. Confirm an `invited` row in `inbound_signup` BEFORE switching anything off.

## Open decisions for Gary

- **Should a studio be able to change plan during onboarding?** Currently closed deliberately.
- **Stripe Tax**: `automatic_tax` is OFF in live; flat AU GST is applied on CURRENCY, not the
  studio's country. That is how a NZ business was charged AU GST. Accountant question.

## Known, deliberately NOT fixed

- Supabase JS SDK loads from a CDN at a floating major, no SRI/CSP, on the six form pages.
- `send-otp` has no per-IP cap: a link holder can mail a studio a code every 60 seconds.

## Scenario B

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT** until the cutover.
- **The match-at-Connect seam is not dead.** `conversation-bind` still resolves by an email guess.
