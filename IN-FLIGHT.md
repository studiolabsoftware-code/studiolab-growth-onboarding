# IN-FLIGHT: Growth Onboarding

Live state only. Completed work and resolved decisions live in `IN-FLIGHT-HISTORY.md`. Verify
anything here against git and the live database rather than trusting the file alone.

Last updated: 2026-08-20

## Waiting on Gary, in this order

1. **Deploy the tier-1 pre-fill.** `bash supabase/manual/deploy-prefill.sh`, THEN push `main`.
   Order matters: `js/form.js` ships via GitHub Pages on any push, so pushing first runs new client
   code against a `send-otp` that has never heard of the invite token. The script gates on the
   Connector's resolver RPC and refuses to deploy without it. Smoke steps are in the script's
   closing note; use a private window and a plus-alias, or you will smoke against your own existing
   draft and the no-clobber rule will correctly write nothing.
2. **Take the `email_event` ledger live** (Growth Connector repo):
   `bash supabase/manual/deploy-mailgun-event-webhook.sh`, then its smoke, then point Mailgun at it.
3. **The signup cutover, inside StudioLAB Growth.** Rotate `SIGNUP_WEBHOOK_SECRET`, audit every
   automation that sends an onboarding email on sub-account creation, then flip both switches in one
   sitting: point the automation's webhook at `signup-webhook-receiver` and disable the platform's
   own onboarding emails. Never do the second without the audit. Runbook:
   `outputs/signup-email-cutover-runbook.md`.

## Open decisions for Gary

- **Should a studio be able to change plan during onboarding?** `plan` was removable by the browser
  on every autosave and `create-checkout-session` prices off it, so a Dominate AI studio could open
  `/au/launch/` and check out at Launch pricing. That is now closed (`plan` is off `save-draft`'s
  allow-list, and the invite token decides the plan). If you WANT studios to be able to switch, it
  needs a deliberate server-side path, not an autosave side effect.
- **Two pre-existing items deliberately NOT fixed in the pre-fill slice**, both recorded rather than
  silently carried: the Supabase JS SDK is loaded from a CDN at a floating major version with no
  SRI and no CSP on the six form pages; and `send-otp` has no per-IP cap, so a link holder can mail
  a studio a code every 60 seconds indefinitely.

## State of the Scenario B thread

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT** in the Connector. It mints the pre-bind
  token and emails `…/{region}/{plan}?t=<token>`. Nothing calls it until step 3 above.
- **Tier-1 pre-fill is BUILT** (this repo + one Connector migration), reviewed, green, not deployed.
  A studio clicking their invite no longer retypes their email and lands on a pre-filled step 1.
- **Tier 2 pre-fill (address, phone, website) is CANCELLED** on its own evidence: the fleet-wide
  check found those fields absent or junk. The form still ASKS for them, deliberately.
- **Studio-specific branding of the form is not possible.** The ADR-0018 fleet scan found zero
  branding custom values anywhere, so there is nothing to pull.

## Answered, recorded so it is not re-asked

- **Does the platform send its own signup email?** Yes, and it links to this form. Gary is disabling
  it as part of the cutover.
- **Why is there still an OTP on the token path?** The token is a bearer credential sitting in an
  inbox. It removes typing, never verification. Worst case for a forwarded link is a code mailed to
  the legitimate studio.
