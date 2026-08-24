# IN-FLIGHT: Growth Onboarding

Live state only. Completed work lives in `IN-FLIGHT-HISTORY.md`. Verify anything here against the
live database, not this file. Last updated: 2026-08-24.

## Waiting on Gary

**The signup cutover, inside StudioLAB Growth. THIS is go-live, and the only thing left.**
`SIGNUP_WEBHOOK_SECRET` is ROTATED and verified (2026-08-24); the value sits in the Connector's
gitignored `supabase/manual/.rotated-signup-secret`, never printed to a transcript. Remaining: audit
every automation emailing on sub-account creation (KEEP the login-credentials email, disable the
welcome one), then flip both switches in one sitting. Never the second without the audit. The
executable pack (endpoint, payload contract, exact plan/region vocabulary) is in the PRIVATE repo:
`Growth Connector/docs/signup-email-cutover-pack.md`. THIS repo is public, so
`outputs/signup-email-cutover-runbook.md` is only a pointer plus the non-sensitive half.

**Silent-hold hazard.** An unmapped `plan`/`region` makes the receiver answer `200 {held:true}`,
writing NO row and sending NO email. With platform emails off that is a total silent failure, and
`missed-signup-sweep` cannot catch it (a hold records nothing). Confirm an `invited` row in
`inbound_signup` BEFORE switching anything off.

## Deployed, verified live, and PROVEN by a real click

- **Tier-1 pre-fill is LIVE.** `send-otp` v39, `verify-otp` v36, plus `save-draft`,
  `get-studio-account` and `apply-change-request` off the gateway block. The LIKE-injection that let
  an unauthenticated caller read every submission is closed.
- **C3 is LIVE** (Connector): both operator read RPCs now return `location_id`, and
  `onboarding-read` is redeployed. The Review drawer, which had 400'd on every open since
  2026-06-25, works for the first time.
- **The LIKE-wildcard sweep is LIVE.** Migration 049's three constraints are VALIDATED and all 25
  functions redeployed (verified against the catalog, not the script's output).
- **The end-to-end smoke PASSED 2026-08-24** and was cleaned up. A real click proved the whole
  chain: signup webhook, Mailgun invite, token resolve, OTP, pre-filled form, server-side
  `location_id` stamp, the widened read RPCs, and the console drawer (which had failed on every open
  since 2026-06-25). Both tables are empty again.

## The submissions table is deliberately EMPTY

All five rows were test data, deleted 2026-08-21 with three test invoices, the 99%-off test code and
a dormant admin account. **No real studio has ever completed this form.** An empty Review queue is
the truth, not a bug, and any smoke needs synthetic data.

## Open decisions for Gary

- **Should a studio be able to change plan during onboarding?** `plan` was removable by the browser
  on every autosave and `create-checkout-session` prices off it, so a Dominate AI studio could open
  `/au/launch/` and check out at Launch pricing. That is now closed (`plan` is off `save-draft`'s
  allow-list, and the invite token decides the plan). If you WANT studios to be able to switch, it
  needs a deliberate server-side path, not an autosave side effect.
- **Is Stripe Tax configured for live mode?** `stripe_mode` is `live`. An earlier session recorded
  that automatic tax was deliberately off in test mode and had to be verified at cutover against the
  business address and AU GST registration. Whether that check ever happened is unknown from here.
  Tax question, not a technical one: route it to the accountant.

## Known, deliberately NOT fixed

- The Supabase JS SDK loads from a CDN at a floating major, no SRI, no CSP, on the six form pages.
- `send-otp` has no per-IP cap: a link holder can mail a studio a code every 60 seconds.

## Scenario B, live state only (settled decisions moved to `IN-FLIGHT-HISTORY.md` 2026-08-21)

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT.** Nothing calls it until step 3 above.
- **The match-at-Connect seam is not dead yet.** C3 made `location_id` readable; `conversation-bind`
  still resolves by an email guess. That slice is queued in the Connector's `IN-FLIGHT.md`.
