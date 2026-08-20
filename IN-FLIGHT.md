# IN-FLIGHT: Growth Onboarding

Live state only. Completed work and resolved decisions live in
`IN-FLIGHT-HISTORY.md`. Verify anything here against git and the live database
rather than trusting the file alone.

Last updated: 2026-08-20

## Built, not deployed

- **C1 `signup-webhook-receiver`** is in the **Growth Connector** repo, green,
  deploy gated on Gary. Needed before the `?t=` pre-fill path does anything.

## Next slices, in order

1. **Abandoned-onboarding, population A.** The nudge cron only reaches studios
   who have a draft, meaning they opened the form and verified their email. A
   studio who signed up and never opened it leaves no row in `public.submissions`
   at all; the only record is `growth_manager.inbound_signup`, written by the
   Connector's `signup-webhook-receiver`. That function is built and green but
   NOT DEPLOYED, so that population does not exist in the database yet. When it
   ships, add a second pass in `nudge-abandoned-onboarding` over inbound_signup
   rows with no matching submission. The scope note at the top of that function
   says the same thing.
2. **Pre-fill, Scenario B.** Plan in `outputs/onboarding-prefill-scenario-b-plan.md`.
   Server-side token resolve only, never client-side. Blocked on the same C1
   deploy plus the signup-email question below.
3. **Voice pass.** Accuracy is done. Worth a look: the door and step 1 both open
   with "Welcome to StudioLAB Growth", and `kb.html`, the admin console and the
   outbound email templates were never swept for accuracy at all.

## Waiting on Gary

1. Does StudioLAB Growth send its own onboarding email at signup, and how many?
   Gates the whole cutover. Step 1 of `outputs/signup-email-cutover-runbook.md`.
2. Does the platform's AI knowledge base now read the StudioLAB database
   automatically? If yes, `kb.html` shrinks to "any specific requirements?". If no,
   keep it: our capture is the source and `copy-kb-for-ghl` exports the Markdown
   that gets pasted into the platform. The 2026-06-20 KB-retirement decision applied
   to the rebuilt form, shelved 2026-07-23, so it never took effect on the live path.
