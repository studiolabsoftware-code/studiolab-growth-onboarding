# IN-FLIGHT: Growth Onboarding

Live state only. Completed work and resolved decisions live in
`IN-FLIGHT-HISTORY.md`. Verify anything here against git and the live database
rather than trusting the file alone.

Last updated: 2026-08-20

## Built, not deployed

- **C1 `signup-webhook-receiver`** is in the **Growth Connector** repo, green,
  deploy gated on Gary. Needed before the `?t=` pre-fill path does anything.

## Next slices, in order

1. **Form dead code.** `js/form.js` `buildPayload` (~line 1298) writes nine `kb_*`
   fields from `kb-` inputs that exist in no route. All twenty-one live in
   `kb.html`, which uses `js/kb.js`. They always write null, so a form re-save
   after a studio completes their knowledge base would wipe it.
2. **Accuracy sweep, then voice.** Audit copy against what the code does before
   touching tone: every defect found on 2026-08-20 was friendly but untrue and
   would survive a voice pass. Known live ones:
   - The domain card still claims "we set up SPF, DKIM and DMARC for you... There
     is nothing technical for you to do" (`au/scale` ~line 432). We cannot without
     DNS access, and it suppresses the signal that should route that studio to
     Done For You.
   - Three setup durations for the same plan. The door and gate say 5/10/15 minutes
     per plan (matches `js/setup-gate.js` `PLAN_MINS`, treat as canon); the step-1
     card says 10 on Launch and 15 on Scale, plus "ready in 3 to 7 business days"
     against `account.html`'s "1 to 2 business days" for the same plans.
   - `js/form.js` `enterForm` reads `#restoredBanner`, which exists in no route.
     Guarded, so dead rather than broken.
   - Every route carries one unclosed `<div>`, present before the door.
3. **Pre-fill, Scenario B.** Plan in `outputs/onboarding-prefill-scenario-b-plan.md`.
   Server-side token resolve only, never client-side. Blocked on both questions
   below plus the C1 deploy.

## Waiting on Gary

1. Does StudioLAB Growth send its own onboarding email at signup, and how many?
   Gates the whole cutover. Step 1 of `outputs/signup-email-cutover-runbook.md`.
2. Does the platform's AI knowledge base now read the StudioLAB database
   automatically? If yes, `kb.html` shrinks to "any specific requirements?". If no,
   keep it: our capture is the source and `copy-kb-for-ghl` exports the Markdown
   that gets pasted into the platform. The 2026-06-20 KB-retirement decision applied
   to the rebuilt form, shelved 2026-07-23, so it never took effect on the live path.
