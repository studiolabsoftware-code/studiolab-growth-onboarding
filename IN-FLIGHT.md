# IN-FLIGHT: Growth Onboarding

Live state only. Completed work lives in `IN-FLIGHT-HISTORY.md`. Verify anything here against the
live database, not this file. Last updated: 2026-08-21.

## Waiting on Gary

1. **Take the `email_event` ledger live** (Growth Connector repo). Do this BEFORE the cutover: today
   a bounced invite is silently invisible, and the failure it prevents is a studio signing up, never
   receiving their link, and nobody finding out. `MAILGUN_WEBHOOK_SIGNING_KEY` is NOT in the vault
   yet, so fetch it from Mailgun first (Settings, API keys, "HTTP webhook signing key" - the
   account-level one, not a sending key). Then
   `bash supabase/manual/deploy-mailgun-event-webhook.sh` (prompts for it, no echo), then
   `bash supabase/manual/smoke-mailgun-event-webhook.sh`, then point Mailgun at the endpoint.

2. **The signup cutover, inside StudioLAB Growth. THIS is go-live.** Rotate
   `SIGNUP_WEBHOOK_SECRET`, audit every automation that emails on sub-account creation, then flip
   both switches in one sitting: point the automation's webhook at `signup-webhook-receiver` and
   disable the platform's own onboarding emails. Never the second without the audit. Runbook:
   `outputs/signup-email-cutover-runbook.md`.

## Deployed, verified live, and PROVEN by a real click

- **Tier-1 pre-fill is LIVE.** `send-otp` v39, `verify-otp` v36, plus `save-draft`,
  `get-studio-account` and `apply-change-request` off the gateway block. The LIKE-injection that let
  an unauthenticated caller read every submission is closed.
- **C3 is LIVE** (Connector): both operator read RPCs now return `location_id`, and
  `onboarding-read` is redeployed. The Review drawer, which had answered 400 on every open since
  2026-06-25, works for the first time.
- **The LIKE-wildcard sweep is LIVE.** Migration 049's three constraints are VALIDATED and all 25
  functions redeployed (verified against the catalog, not the script's own output).
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
