# IN-FLIGHT: Growth Onboarding

Live state only. Completed work and resolved decisions live in `IN-FLIGHT-HISTORY.md`. Verify
anything here against git and the live database rather than trusting the file alone.

Last updated: 2026-08-21

## Waiting on Gary

1. **Deploy the LIKE-wildcard sweep.** `bash supabase/manual/deploy-like-wildcard-sweep.sh`.
   Applies migration 049, then redeploys 25 functions, urgent three first. Takes a few minutes:
   two of the changed files are in `_shared/`, and Supabase bundles shared sources at DEPLOY time,
   so a shared fix reaches a function only when that function is itself redeployed.
   The two that carry a live defect: `_shared/pricing.ts`, where posting `%` as a discount code on
   the PUBLIC checkout path matched whatever code was in the table, and `inbound-message`, where the
   From header of an inbound email could match an admin row and file the message as sent by them.

2. **Take the `email_event` ledger live** (Growth Connector repo):
   `bash supabase/manual/deploy-mailgun-event-webhook.sh`, then its smoke, then point Mailgun at it.

3. **The signup cutover, inside StudioLAB Growth.** Rotate `SIGNUP_WEBHOOK_SECRET`, audit every
   automation that sends an onboarding email on sub-account creation, then flip both switches in one
   sitting: point the automation's webhook at `signup-webhook-receiver` and disable the platform's
   own onboarding emails. Never do the second without the audit. Runbook:
   `outputs/signup-email-cutover-runbook.md`.

## Deployed 2026-08-21, smoke still unrun

- **Tier-1 pre-fill is LIVE.** `send-otp` v39, `verify-otp` v36, plus `save-draft`,
  `get-studio-account` and `apply-change-request` off the gateway block. The LIKE-injection that let
  an unauthenticated caller read every submission is closed in production.
- **C3 is LIVE** (Connector): both operator read RPCs now return `location_id`, and
  `onboarding-read` is redeployed. The Review drawer, which had answered 400 on every open since
  2026-06-25, works for the first time.
- **The end-to-end smoke has not been run.** Do it with a synthetic invite and a plus-alias you have
  never used, in a private window. Steps are in `deploy-prefill.sh`'s closing note.

## The submissions table is deliberately EMPTY

All five rows were test data and were deleted on 2026-08-21, along with three test invoices, the
99%-off test discount code, and a dormant admin account. **No real studio has ever completed this
form.** An empty Review queue is the truth, not a bug, and a smoke test needs synthetic data.

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

- The Supabase JS SDK loads from a CDN at a floating major version with no SRI and no CSP on the six
  form pages.
- `send-otp` has no per-IP cap, so a link holder can mail a studio a code every 60 seconds.

## Scenario B, live state only (settled decisions moved to `IN-FLIGHT-HISTORY.md` 2026-08-21)

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT.** Nothing calls it until step 3 above.
- **The match-at-Connect seam is not dead yet.** C3 made `location_id` readable; `conversation-bind`
  still resolves by an email guess. That slice is queued in the Connector's `IN-FLIGHT.md`.
