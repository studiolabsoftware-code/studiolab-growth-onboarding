# IN-FLIGHT history: Growth Onboarding

Append only. Not read at session start. Completed work and closed decisions.

## 2026-08-20: welcome door (step 0)

Replaces the cold email-entry auth card on all six routes
(`{au,us}/{launch,scale,ai}`). Warm site palette ported verbatim from
studiolab-website `app/marketing.css`, the site's hero recipe
(`public/lifestyle/class.webp`, the 105deg gradient, 60px grid, fractal noise),
a four-stage progress track, a product showcase, and the OTP fields on the hero.

Files: `css/door.css`, `assets/onboarding-hero.webp`,
`scripts/build-welcome-door.js` (regenerates the markup in all six routes; edit
the script, never the six copies), plus a one-line `body.door-open` toggle in
`js/form.js` `showAuthGate()`. The auth flow itself is unchanged: every id
`form.js` binds to is preserved.

Changed from the approved prototype, each because the prototype claim was not
true of the live form:

- Track stage 3 was "Pick your setup path", shown as a step after the form. The
  choice is inside the form at step 5, which the Launch route's own copy already
  states. It now reads "Choose your setup and pay".
- The floats hung off a 1120px frame and covered the card's own text at 780px.
  They are a two-up row under the conversation now.
- The hero no longer shows a studio name. Nothing resolves one before OTP, and
  the pre-fill design is explicit that the token must never unlock identity in
  the browser. Personalisation ships with the pre-fill slice.

### Closed: should the door's progress track be stateful? No.

A studio past stage 2 never sees the door. `js/form.js` `init()` bounces paid
studios to `account.html` (or `kb.html` on Dominate AI) and `js/setup-gate.js`
does the same after OTP, so the marker is at stage 2 for everyone who can see it
and reading their row would change nothing. `account.html` stays the stateful
surface and already has its own status block. Stage 4 is a promise of sequence,
never a claim about state, so the unproven `admin-mark-active` path cannot make
the door lie. Verified in production: no submission has ever reached
`status='active'`.

## 2026-08-20: the AI knowledge base is retired, entirely

Gary confirmed StudioLAB Growth builds and populates the AI knowledge base
itself, from the studio's own data, and that it holds its own rules (including
never confirming pricing to a family). Facts and rules both. Nothing on our side
feeds it, so the whole capture pipeline was dead weight rather than something to
shrink.

Removed: `kb.html`, `js/kb.js`, `css/kb.css`, the `save-kb`, `get-kb-status`,
`copy-kb-for-ghl`, `scrape-and-extract`, `add-website-and-scrape` and
`nudge-abandoned-kb` functions (deleted from the platform, all now 404), four
`_shared/kb-*.ts` modules, the KB section of the handoff document and of the
submission digest email, the admin KB panel and its "Copy KB as Markdown"
button, the KB fields from the studio and admin change-request surfaces and from
`apply-change-request`'s allow-list and `sync-to-sheet`'s column list, and the
`nudge-abandoned-kb-daily` cron.

The strongest evidence it was really gone: the old flow ended with a human
opening a studio's record, clicking a button, and pasting Markdown into the
platform by hand. Nobody is pasting anything now.

`get-kb-status` was doing double duty as the post-payment poller under a
misleading name, so it was replaced by `get-submission-status` rather than
simply deleted, and `payment-confirm.html` now points at that. Dominate AI
studios go straight from payment to `account.html` like every other plan; the
`/kb.html` detours in `payment-confirm.html`, `js/setup-gate.js` and
`js/form.js` are gone, as is the website scrape that fired on the pay button.

Copy on both AI routes rewritten: the AI answers from studio data already in
StudioLAB, it stays current on its own, it holds its own rules including never
confirming pricing, and there is nothing for the studio to write or approve.

Safe because production had never used it: no studio has ever completed a
knowledge base, no scrape has ever run, and the only paid studio is on Launch.

Two things worth remembering. `scripts/apply-copy-fixes.js` had an edit whose
find string was a substring of its own replacement, so it re-applied on every
run and duplicated a comment block four times before it was caught; edits like
that now carry an explicit `doneWhen`. And a full `deno check` sweep across
every function in a tight loop reports false errors and times out; check the
functions actually touched, plus their consumers, individually.

## 2026-08-20: escalation to a human, and standing ops reminders

Gary's point: chasing the studio by email cannot solve an email problem. The
studios most at risk are the ones our invite never reached (junk, bad address),
and from our side they look identical to the ones who ignored it. They have also
paid for a subscription they cannot use.

So `nudge-abandoned-onboarding` now escalates as well as nudges. After 7 days
with no movement, or immediately on a confirmed bounce or spam complaint, the
account owner gets one email per studio carrying the contact, how many
follow-ups went out, and the actual delivery status pulled live from Mailgun's
Events API (`_shared/mailgun-events.ts`). An unreachable studio gets a red banner
saying to phone them rather than email again. Migration 046 adds
`onboarding_escalated_at`.

New `ops-reminders` function and `public.ops_reminders` table: standing internal
nags for tasks only a human can do, repeating on their own interval until the
one-click link in the email closes them. Verified end to end against the
deployed function with a throwaway row: first click closes it, second says
already done, a bad token is refused. The one-click GET needs
`verify_jwt = false` because it is opened from an email client with no auth
header at all; its own random token is the gate and the worst case is a closed
reminder.

### The pre-build gate paid for itself here

Before building "cover the studios who never opened the form", checked what
exists. The Connector already has BOTH halves: `missed-signup-sweep` reconciles
live sub-accounts from the deployed `ghl-adapter` against `inbound_signup` and
invites anyone missed, and `mailgun-event-webhook` records every delivery event.
Neither is deployed and their tables do not exist. Building a parallel version
in this repo would have duplicated a working design. Deploying them is Gary's
call, since the sweep sends real invites to real studios.

### Sequencing hazard, recorded because it would have been expensive

Gary said he would turn off the platform's own signup email since ours replaces
it. Ours does not exist in production yet, and the platform's email is currently
the only thing that gets a studio to the form. Disabling it first would leave
new studios with no way in. That is now a standing reminder with the correct
order in its body.

## 2026-08-20: copy accuracy fixes, and the abandoned-onboarding follow-up

All 14 audited defects resolved per Gary's decisions. Route edits run through
`scripts/apply-copy-fixes.js`, which asserts a hit count per replacement and is
idempotent. Headlines: the SSN field is gone everywhere (see below), texting and
custom-domain copy now say what the studio has to do, Done-For-You is
repositioned as "not hands-off", and there is one duration (10 minutes) and one
turnaround (3 to 5 days, 7 to 10 on Dominate AI) across every surface. Full
findings: `outputs/onboarding-claims-audit.html`.

### Closed: do we need the US owner's SSN? No.

Researched the platform side before deciding, as Gary asked. A US sole
proprietor proves identity through the A2P brand check, which runs a
third-party ID verification (Persona) inside their own sub-account, in their own
browser. We can neither run it for them nor feed digits into it. Registration
itself happens in Settings, Phone Numbers, in the studio's own sub-account, and
AU numbers need a Regulatory Bundle with their own documents. The knowledge-base
canon already says A2P is a post-payment operational item and "the studio should
not feel like they are buying a compliance project." `account.html`'s `sms_a2p`
task already collects the pre-work that IS useful and never asked for an SSN.
Removed from the routes, `buildPayload`, the hydrate map, the admin display and
`save-draft`'s allow-list. No production row ever held one.

### Abandoned-onboarding follow-up

`nudge-abandoned-onboarding`, daily at 23:30, three emails then stop: about day
3, day 7 and day 14 from last activity. Migration 045 adds
`onboarding_nudge_count` and `onboarding_nudged_at`. Respects the studio email
opt-out and the test-mode gate. Dry run on production returned 3 draft rows, all
due for step 1.

### Two things found while building it

- `nudge-abandoned-kb` and `nudge-setup-tasks` sent through Mailgun directly,
  bypassing the test-mode gate, so a test-mode cron run would have emailed real
  studios. Both now use `createGatedSender`. (`quote-reminders` was already
  correct; it hand-rolls the same logic inline rather than importing the helper.)
- The cron functions had been deployed with `--no-verify-jwt` on the command
  line, which is invisible in the repo. Redeploying `nudge-abandoned-kb` without
  the flag re-enabled JWT verification and broke its nightly job, since the crons
  authenticate with a non-JWT `CRON_SECRET`. Now declared in `supabase/config.toml`
  for all five cron-invoked functions, so a plain deploy keeps the setting. The
  dry run is what caught it.

## 2026-08-20: knowledge base could be nulled by the onboarding form

`js/form.js` `buildPayload` sent `kb_profile`..`voice_escalate` on every save,
reading `kb-*` and `voice*` inputs that exist in no route (all 21 live in
`kb.html`, which uses `js/kb.js`). Those columns were in `save-draft`'s
allow-list, so the nulls were written.

Reachable and destructive, though not by the route first suspected. A re-save
after a studio types their KB is impossible: `save-draft` refuses once `status`
leaves `draft`. The live path was the **website scrape**. On Dominate AI the pay
button fires `scrape-and-extract`, which populates the `kb_*` columns while
status is still `draft`. A studio who cancels at Stripe returns to a live form
inside that same `draft` window, and the next autoSave nulled the scraped
knowledge base. `kb_scrape_status` was already `complete`, so the KB page would
not re-scrape and the studio saw empty fields where their pre-fill should have
been.

Fixed on both sides: the keys are gone from `buildPayload`, and `kb_*` /
`voice_*` are out of `save-draft`'s allow-list so `save-kb` (plus the
service-role scraper) is now their only writer. Verified against the deployed
function with a temporary draft row: a payload of
`{kb_profile:null, kb_faqs:[], voice_hours:null, studio_name:'After'}` updated
`studio_name` and left all three KB sentinels intact. Test row deleted; the four
production rows are unchanged.

## Earlier

- Onboarding form refinement: optional fields, SMS collapse, consent, honest copy.
- Socials retirement: pasted `facebook`/`instagram`/`tiktok`/`youtube` handles gone
  from all six routes. Facebook as a *lead source* on Scale and Dominate AI stands.

## Moved out of IN-FLIGHT 2026-08-21 (settled, no longer live state)

## State of the Scenario B thread

- **C1 `signup-webhook-receiver` is DEPLOYED and INERT.** It mints the pre-bind token and emails
  `…/{region}/{plan}?t=<token>`. Nothing calls it until step 3 above.
- **Tier 2 pre-fill (address, phone, website) is CANCELLED** on its own evidence: the fleet-wide
  check found those fields absent or junk. The form still ASKS for them, deliberately.
- **Studio-specific branding of the form is not possible.** The ADR-0018 fleet scan found zero
  branding custom values anywhere, so there is nothing to pull.
- **The match-at-Connect seam is not dead yet.** C3 made `location_id` readable; `conversation-bind`
  still resolves by an email guess. That slice is queued in the Connector's `IN-FLIGHT.md`.

## Answered, recorded so it is not re-asked

- **Does the platform send its own signup email?** Yes, and it links to this form. Gary is disabling
  it as part of the cutover.
- **Why is there still an OTP on the token path?** The token is a bearer credential sitting in an
  inbox. It removes typing, never verification. Worst case for a forwarded link is a code mailed to
  the legitimate studio.

## 2026-08-26 (later): the webhook health check is scheduled, and two other crons were found dead

Item 1 of the day's handover was "schedule `stripe-webhook-health`, copying 019_quote_reminders.sql".
Copying 019 would not have worked, and finding out why turned up a second silent outage.

**019 and 020 read two Supabase Vault secrets that contain the placeholder text from 019's own
comment block.** `studiolab_project_url` was the literal `https://YOUR-PROJECT.supabase.co` and
`studiolab_service_role_key` the literal `YOUR-SERVICE-ROLE-KEY`, both stored 2026-05-14 by someone
running the "one-time setup" example lines verbatim. So `quote-reminders-daily` and
`cleanup-attachments-daily` had fired daily ever since without once reaching an edge function:
`net._http_response` recorded `Couldn't resolve host name` against a null status code, while
`cron.job_run_details` reported `succeeded`, because the SQL itself ran fine. Same defect class as
the `whsec_PASTE_HERE` incident earlier the same day, three months older. No harm had come of it
only because `quotes` and `submission_attachments` were both still empty.

**The pattern that does work** is the one used by `ops-reminders-daily` and
`nudge-abandoned-onboarding-daily`: a `CRON_SECRET` bearer, not the service-role key. Job 6 returned
a real 200 the previous night, which is stronger evidence than any digest comparison. It is also the
smaller blast radius, a dedicated cron token instead of the highest-privilege key in the project.

Shipped:
- `_shared/cron-auth.ts` + 10 tests. Dependency-free, because `caller.ts` imports supabase-js from
  esm.sh and cannot be imported under `deno test --allow-read`. Constant-time compare, and it fails
  closed on an unset `CRON_SECRET` (otherwise `'' === ''` opens the endpoint to anonymous callers,
  which is a test).
- `stripe-webhook-health` now accepts `isCronCaller || isServiceRoleCaller`.
- **`config.toml` gained `[functions.stripe-webhook-health] verify_jwt = false`.** It was absent.
  Without it the gateway rejects a non-JWT `CRON_SECRET` bearer with
  `UNAUTHORIZED_INVALID_JWT_FORMAT` before the function runs, so the health check's very first
  scheduled run would have failed with exactly the invisible fault it exists to detect. This is the
  2026-08-20 `nudge-abandoned-kb` incident repeating.
- Migration `050`: repairs `studiolab_project_url`, promotes `CRON_SECRET` into the vault as
  `studiolab_cron_secret` (sourced from the live cron job inside the database, never written into
  this PUBLIC repo), and schedules `stripe-webhook-health-6h` at `40 */6 * * *`. It deliberately
  drops 019's `case ... else 'skipped'` wrapper: a missing secret now makes `url := null` raise and
  the run is recorded FAILED. The silent-skip wrapper is why nobody noticed those jobs were dead.

Six-hourly, not hourly, because the function emails every admin on every unhealthy run by design.
Hourly means 24 alerts a day for a fault needing a human in the Stripe dashboard, and a muted alert
is a dead alert. This bounds the silent window at 6 hours against the 15 days it actually took.

Verified: cron job 7 active; a manual run of the exact cron path returned
`{"ok":true,"healthy":true,"mode":"live","endpoint_id":"we_1U8VYxCcwFH6sWzIYNEKgr57"}`; unauthenticated
and wrong-bearer POSTs both 403. Gate green: `deno check`, 45 `_shared` tests (was 35), `node --check`.

Migrations here are applied by hand: `supabase migration list --linked` shows an empty Remote column
for all 50, so `supabase db push` would try to replay every one against the live schema.

NOT fixed, deliberately: `quote-reminders` and `cleanup-attachments` still read the placeholder
service-role key and remain dead. Repointing them at `CRON_SECRET` is a code change plus redeploy
for both, so it is its own slice.

## 2026-08-26 (later still): the two dead crons repointed, all five now proven

Follow-on slice to 050. `quote-reminders` and `cleanup-attachments` both accepted only
`isServiceRoleCaller`, reading the Vault entry that held `YOUR-SERVICE-ROLE-KEY`, so neither had run
since it was written. Both now accept `isCronCaller || isServiceRoleCaller`, matching
`stripe-webhook-health`. `config.toml` already carried `verify_jwt = false` for both, so no gateway
change was needed.

Migration `051` reschedules both jobs against `studiolab_project_url` + `studiolab_cron_secret`,
keeping their existing cadences (22:15 and 22:30 UTC). It opens with a guard that raises if either
secret is missing or still looks like a placeholder, so it cannot quietly recreate the fault it
fixes, and it drops the `case ... else 'skipped'` wrapper for the same reason 050 did.

Old jobs 3 and 4 were unscheduled and replaced by 8 and 9; `cron.job` now holds exactly five jobs
with no duplicates. First successful runs of either function, ever:

    quote-reminders     {"ok":true,"stats":{"nudged":0,"warned":0,"cancelled":0,"errors":[]},"stripe_mode":"live"}
    cleanup-attachments {"ok":true,"stats":{"deleted":0,"storage_failed":0,"row_failed":0,"errors":[]}}

Both are honest no-ops: `quotes` and `submission_attachments` were re-confirmed empty immediately
before invoking, which is also why running the real sweep rather than a dry run was safe (neither
function has a dry-run mode).

Rejection still verified on all three: `quote-reminders` and `cleanup-attachments` answer 401 to an
absent and a wrong bearer, `stripe-webhook-health` answers 403. Gate green throughout: `deno check`
on both functions, 45 `_shared` tests, `node --check`.

`studiolab_service_role_key` is deliberately left as the placeholder. Nothing reads it any more, and
repairing it would mean handling the project's highest-privilege key for no benefit.
