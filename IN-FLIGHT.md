# IN-FLIGHT: Growth Onboarding

Live state only. Completed work and resolved decisions live in
`IN-FLIGHT-HISTORY.md`. Verify anything here against git and the live database
rather than trusting the file alone.

Last updated: 2026-08-20

## Built, not deployed

- **C1 `signup-webhook-receiver`** is in the **Growth Connector** repo, green,
  deploy gated on Gary. Needed before the `?t=` pre-fill path does anything.

## Blocked on Gary, and the order matters

1. **Do NOT turn off the platform's signup email yet.** Gary said on 2026-08-20
   that the platform sends its own signup email linking to our form, and that he
   would disable it. Right now that email is the ONLY thing that gets a studio to
   the form. Our replacement (`signup-webhook-receiver`) is built, undeployed, its
   tables do not exist, and the webhook is not pointed at us. Correct order:
   apply the Connector migrations, deploy the receiver, point the platform's
   signup automation at it, watch one real signup produce our invite, THEN
   disable the platform email. A standing `ops_reminders` row emails Gary every
   2 days about this until he taps the one-click done link.
2. **Deploy the Connector's `missed-signup-sweep` and `mailgun-event-webhook`.**
   Both are built and green; neither is deployed and their tables
   (`growth_manager.inbound_signup`, `growth_manager.email_event`) do not exist.
   The sweep is exactly the "studios who never opened the form" cover Gary asked
   for: it reconciles live sub-accounts from the already-deployed `ghl-adapter`
   against `inbound_signup` and invites anyone missed. Gary's call, not Claude's,
   because deploying it sends real invite emails to real studios.

## Next slices

1. **Retire the knowledge-base capture.** Gary confirmed 2026-08-20 that the
   platform's AI knowledge base now reads the StudioLAB database automatically
   and is pre-built and auto-populating. He believes it reads the studio website
   too but wants to confirm that separately, so treat the website half as
   assumed, not established. If both hold, this touches: `kb.html` (21 inputs),
   `save-kb`, `get-kb-status`, `copy-kb-for-ghl`, `nudge-abandoned-kb`,
   `scrape-and-extract`, the AI route's step-1 copy ("we scan your website and
   pre-fill your AI knowledge base"), `account.html`'s AI stages, and the
   post-payment redirect to `/kb.html`. Scope it before touching anything.
2. **Population A pass in `nudge-abandoned-onboarding`,** over `inbound_signup`
   rows with no matching submission. Blocked on item 2 above.
3. **Pre-fill, Scenario B.** Plan in `outputs/onboarding-prefill-scenario-b-plan.md`.
4. **Voice pass.** Accuracy is done. The door and step 1 both open with "Welcome
   to StudioLAB Growth"; `kb.html`, the admin console and outbound email
   templates were never swept for accuracy at all.

## Answered, recorded here so it is not re-asked

- **Does the platform send its own signup email?** Yes, and it links to this
  form. Gary is disabling it, sequencing above.
- **Does the AI knowledge base read the database automatically?** Yes, and it is
  pre-built and auto-populating. Website reading is assumed but unconfirmed.
