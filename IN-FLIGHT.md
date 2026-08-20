# IN-FLIGHT: Growth Onboarding

Live state only. Completed work and resolved decisions live in
`IN-FLIGHT-HISTORY.md`. Verify anything here against git and the live database
rather than trusting the file alone.

Last updated: 2026-08-20

## Built, not deployed

- **C1 `signup-webhook-receiver`** is in the **Growth Connector** repo, green,
  deploy gated on Gary. Needed before the `?t=` pre-fill path does anything.

## Next slices, in order

1. **Fix the 14 audited copy defects.** The sweep is DONE (2026-08-20), nothing is
   fixed yet. Full findings with evidence: `outputs/onboarding-claims-audit.html`
   (published at https://claude.ai/code/artifact/969420d0-136e-491e-a527-052455b0e318).
   Four passes, in order:
   - **Pass 1, data and commitments.** Plan-gate the SSN/EIN fields (`us/launch`
     shows a REQUIRED SSN-last-4 on a plan with no SMS: `applyBusinessTypeConditionals()`
     keys on country + business type, never plan). Narrow the Launch consent clause,
     which authorises text messages Launch cannot send.
   - **Pass 2, promises we cannot keep.** The DNS card (SPF/DKIM/DMARC "nothing
     technical for you to do", 12 instances) and the texting card ("you do not need
     any technical setup" vs the A2P task list in `account.html`).
   - **Pass 3, one numbers pass.** Form duration (door vs step 1 disagree on ALL six
     routes; `PLAN_MINS` in `js/setup-gate.js` is canon) and turnaround (four numbers
     across step 1, the setup cards, and `account.html`). Blocked on Gary, below.
   - **Pass 4, regional + tidy.** `swapSpelling()` only converts the enrol family, so
     US routes read "colour" 9x. Business-type list not region-filtered. Lead sources
     promised in step 1 and never asked (`collectLeads()` reads `input[data-lead]`,
     zero exist). Then the four unreachable items.
2. **Pre-fill, Scenario B.** Plan in `outputs/onboarding-prefill-scenario-b-plan.md`.
   Server-side token resolve only, never client-side. Blocked on both questions
   below plus the C1 deploy.

## Waiting on Gary

1. **Turnaround times, per plan and setup type.** We currently quote 1-2, 3-5, 3-7,
   5-7 and 7-10 business days on different screens. Blocks audit pass 3.
2. **Lead sources: capture them or drop the promise?** Claude recommends adding the
   picker back to step 4. Blocks audit pass 4.
3. **What can we actually offer on custom email domains?** Send records + guide, do it
   live on a call under Done For You, or ask for delegated DNS access. Blocks pass 2.
4. Does StudioLAB Growth send its own onboarding email at signup, and how many?
   Gates the whole cutover. Step 1 of `outputs/signup-email-cutover-runbook.md`.
5. Does the platform's AI knowledge base now read the StudioLAB database
   automatically? If yes, `kb.html` shrinks to "any specific requirements?". If no,
   keep it: our capture is the source and `copy-kb-for-ghl` exports the Markdown
   that gets pasted into the platform. The 2026-06-20 KB-retirement decision applied
   to the rebuilt form, shelved 2026-07-23, so it never took effect on the live path.
