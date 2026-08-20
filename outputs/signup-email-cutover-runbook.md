# Signup email cutover runbook

Status: RUNBOOK (2026-08-20). Do not execute yet. The blocking prerequisite is named below.
Audience: Gary, working inside StudioLAB Growth. Everything else is Claude's.

## Read this first: do not disable anything yet

Disabling the platform's signup emails **before** our receiver is deployed leaves new studios with
**no onboarding email at all**. They sign up, pay, and hear nothing. That is worse than the problem
being fixed.

The prerequisite is `signup-webhook-receiver` deployed and confirmed working (step 2 below). Until
that is done and tested, the platform emails must keep firing exactly as they do now.

The two changes in step 4 also have to happen **in the same sitting**, minutes apart, not days.
Any gap in either direction causes a real failure:

| Order | Result |
|---|---|
| Webhook on, platform emails still on | Studios get two invites with different links. Whether pre-fill works becomes a coin flip. |
| Platform emails off, webhook not on | Studios get nothing. Silent failure, and you only learn about it when one complains. |
| Both switched together | Correct. One email, carrying the token. |

## Why the platform's emails cannot simply stay

They point at the right forms. That part of your configuration is already correct and is not being
thrown away. The problem is that the link they carry is plain.

The token that identifies a studio is minted by our receiver a fraction of a second **after** the
signup fires. The platform does not have it at the moment its own automation runs, so a
platform-sent link cannot tell the form who is arriving. Pre-fill never runs behind that link, no
matter how well the rest is built.

## The cutover, in order

### Step 1. Confirm what exists today (Gary, 10 minutes, safe)

Claude cannot see inside the platform, so this is the one piece of the map drawn from your
description rather than from code. Before anything changes, write down:

- Which automation fires on sub-account creation, and its exact name.
- How many onboarding or welcome emails it sends, and their subject lines.
- The link each one points at (confirm it is `app.studiolabgrowth.com/{au|us}/{launch|scale|ai}`).
- Whether any of them are also used for anything other than signup.

If more than one automation sends an onboarding email, all of them are in scope. A stray second
automation is the most likely way a studio ends up with two links after the cutover.

### Step 2. Deploy the receiver (Claude)

`signup-webhook-receiver` in the Growth Connector repo. Built, reviewed, green, not yet deployed.
It records the signup, mints the pre-bind token, resolves the correct one of the six routes, and
sends the invite.

Note it deliberately **holds** a signup rather than emailing a broken link if the plan or region
cannot be resolved, so a malformed payload produces a held record and no email rather than a
studio receiving a dead link.

### Step 3. Test with a real signup, platform emails still on (both)

Create one genuine test sub-account. Expect:

- A row in `growth_manager.inbound_signup` with the correct `location_id`, email, name, company,
  plan and region.
- Our invite email arriving, with a link ending in `?t=` and a long token.
- That link opening the correct route for the plan and region.
- The platform's own email also arriving, because it is still enabled at this point. That is
  expected and is exactly why this step is safe.

Do not proceed until all of these pass. If the invite does not arrive, the cutover stops here and
nothing has been broken.

### Step 4. The cutover itself (Gary, both changes in one sitting)

1. Point the signup automation's webhook at the deployed `signup-webhook-receiver`, using the
   shared secret Claude provides.
2. Disable every onboarding or welcome email identified in step 1.

Do these minutes apart. Do not do one today and one tomorrow.

### Step 5. Verify with a second real signup (both)

Create a second test sub-account and confirm:

- Exactly **one** email arrives, ours.
- The link carries a token and opens the right route.
- The form recognises the studio (once pre-fill ships, step 6).
- No platform email arrives.

### Step 6. Pre-fill (Claude, can follow later)

Not required for the cutover. Once the invite is the only email and it carries the token, the
form-side work makes the token actually do something: resolve it server-side, send the code to
the address on file, and seed the studio's identity. Plan:
`outputs/onboarding-prefill-scenario-b-plan.md`.

Until this ships, a studio clicking the tokenised link sees today's behaviour, which is a working
form. Nothing regresses.

## Rollback

If anything goes wrong after step 4, re-enable the platform's onboarding emails. That restores
today's behaviour immediately. Our invite continuing to send alongside is the two-email state,
which is untidy but harmless, and it buys time to diagnose without any studio being stranded.

Keep the platform automations **disabled, not deleted**, until at least a few real studios have
come through the new path cleanly.

## Open item

Whether the platform currently sends its own onboarding email, and how many, is taken from Gary's
description. Step 1 exists to turn that into a confirmed list before anything is switched.
