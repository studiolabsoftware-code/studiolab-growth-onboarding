# IN-FLIGHT: Growth Onboarding

Live state only. Completed work lives in `IN-FLIGHT-HISTORY.md`. Verify anything here against the
live database, not this file. Last updated: 2026-08-26.

## WE HAVE A REAL PAYING STUDIO. The table is no longer empty.

Neverland (michelle@neverlandstudios.co.nz), submission `e6978e3f-d85d-4d43-b695-071d07dc0d98`,
paid **AUD 768.90** (699 + 69.90 GST) 2026-08-26 09:52 AEST for "Dominate AI, Done for you".
Invoice `SLG-0204`. Row is now `submitted`/`paid`, receipt sent. She has NO Growth sub-account and
NO plan subscription yet, and Stripe told her the team would be in touch within a few business
days. **That clock started 2026-08-26.** She reached the form directly; the signup webhook is
still inert, so she did not come through it.

## The payment webhook was DEAD for 15 days. Fixed 2026-08-26.

`stripe_events` holds 649 events from 2026-05-14 to **2026-08-11**, then nothing. The platform's
production endpoint was created on the SHARED Stripe account at 2026-08-11 06:07 UTC; ours stopped
~3h later. Someone else with access deleted it. Neverland's payment fell in that window, which is
why she got a Stripe receipt but nothing from us and Gary was never told.

- New endpoint `we_1U8VYxCcwFH6sWzIYNEKgr57`, 18 events, enabled, live. Secret re-set and PROVEN by
  replaying `evt_1U8U9FCcwFH6sWzIqgeJQ19r`: row reconciled, receipt sent, admin email received.
- **The account is shared and the dev team works in it. This can recur.**
- `stripe-webhook-health` is DEPLOYED but **NOT SCHEDULED** and has never had a positive invoke.
  Needs a pg_cron migration passing a service-role bearer. Until then it protects nothing.
- `stripe-webhook` live is **v49 (2026-05-18)**; commit `e4f8ce2` (unsubscribe link) landed 2 min
  after. Michelle's receipt may lack it. Redeploy as its own slice.

## The AU/US routing hole is OPEN

`COUNTRY_TO_REGION` in `js/form.js:266` maps NZ/CA/UK/OTHER to the US route exactly as designed,
and is **dead code, never read**. The country field was removed from the form, so `getCountryValue()`
falls back to the URL region and any studio on `/au/` is hard-set `country='AU'` and priced AUD with
10% GST. Michelle is in Auckland; her phone `+64...` was in the submission before checkout and
nothing looked at it. `create-checkout-session` blocks an Australian on the US form
(`au_must_use_au_flow`) but has NO mirror guard. Gary is holding on Neverland commercially (no
refund, no recharge, negligible dollar difference, handled in accounting) but the FIX is still
wanted. Server-side guard, not a restored dropdown.

## Waiting on Gary

**The signup cutover, inside StudioLAB Growth. Still the go-live item.** `SIGNUP_WEBHOOK_SECRET`
rotated 2026-08-24; value in the Connector's gitignored `supabase/manual/.rotated-signup-secret`.
Remaining: audit every automation emailing on sub-account creation (KEEP the login-credentials
email, disable the welcome one), then flip both switches in one sitting. Pack:
`Growth Connector/docs/signup-email-cutover-pack.md` (PRIVATE repo; this one is public).

**Silent-hold hazard.** An unmapped `plan`/`region` returns `200 {held:true}`, writes NO row, sends
NO email. Confirm an `invited` row in `inbound_signup` BEFORE switching anything off.

## Open decisions for Gary

- **Should a studio be able to change plan during onboarding?** Currently closed deliberately.
- **Stripe Tax**: `automatic_tax` is OFF in live; a flat AU GST rate is applied on CURRENCY, not
  the studio's country. That is how a NZ business was charged Australian GST. Accountant question.

## Known, deliberately NOT fixed

- Supabase JS SDK loads from a CDN at a floating major, no SRI, no CSP, on the six form pages.
- `send-otp` has no per-IP cap: a link holder can mail a studio a code every 60 seconds.

## Scenario B

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT.** Nothing calls it until the cutover.
- **The match-at-Connect seam is not dead.** `conversation-bind` still resolves by an email guess.
