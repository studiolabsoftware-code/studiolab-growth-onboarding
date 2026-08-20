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

1. **Reshape the form to Gary's scope: capture only what StudioLAB does not
   already have, then checkout.** Stated 2026-08-20. The knowledge base is gone,
   so what remains to decide is which of the remaining fields we already hold.
   `outputs/onboarding-prefill-scenario-b-plan.md` has the verified tiers:
   tier 1 (name, email, company, plan, region) we hold today; tier 2 (address,
   phone, website, timezone, business email) needs a 10-minute check against two
   or three real sub-accounts before it can be trusted; tier 3 (branding, logo,
   voice, legal IDs, custom domain, SMS intent, consent) has to be asked. Do the
   tier-2 check first, it decides how much more comes out of the form.
2. **Population A pass in `nudge-abandoned-onboarding`,** over `inbound_signup`
   rows with no matching submission. Blocked on the Connector deploys above.
3. **Pre-fill, Scenario B.** Server-side token resolve only, never client-side.
4. **Voice pass.** Accuracy is done. `kb.html` is gone, but the admin console and
   the outbound email templates were never swept for accuracy.

## Answered, recorded here so it is not re-asked

- **Does the platform send its own signup email?** Yes, and it links to this
  form. Gary is disabling it, sequencing above.
- **Does the AI knowledge base read the database automatically?** Yes, and it is
  pre-built and auto-populating. Website reading is assumed but unconfirmed.
