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

## 2026-08-26 (item 2): the AU/US routing hole closed server-side

`js/form.js` stopped asking for a country, so `getCountryValue()` falls back to the URL and every
studio on /au/ is stored `country='AU'`. `pricing.ts` decides currency from that field alone, so an
Auckland studio was charged AUD with 10% Australian GST. Her submission already carried
a `+64` mobile in `contact_phone` and `address_postcode = '0632'` before checkout. Nothing read
either. `create-checkout-session` guarded only the opposite mistake, via `isAustralianFreeText`.

**Charging-model gate.** Read `CHARGING-MODEL-CANON.md` before designing. Reconciliation: this
surface sits OUTSIDE the two-sided ledger. It creates no charge or payment rows, no allocation, no
stored paid column, and no derived balance; it selects which currency/tax catalog row a studio is
sold at point of sale (`pricing.ts:83` `currencyForCountry`, `:154` the flat 10% AUD rate). None of
the seven rules are engaged. The correctness risk is currency and tax selection, not the ledger.

`_shared/region-guard.ts` + 11 tests. The design rule, which is the whole point: **block only on
POSITIVE contradicting evidence, never on absence.** A false positive stops a real Australian studio
from paying us, which is worse than the fault being fixed.

- Phone: only an explicit international prefix (`+` or `00`) counts. `+61` is Australia, matched
  exactly rather than by prefix so `+62`, `+64`, `+65` and `+66` are not mistaken for it. A national
  number like `0421 056 987` is genuinely ambiguous and is NOT evidence.
- Postcode: letters (UK/CA) or a length other than 4 (US ZIP) are positive evidence. A 4-digit code
  is checked against Australia's allocated ranges (1000-9999, plus 0200-0299 ACT and 0800-0999 NT),
  so `0632` is not merely unusual, it is not an Australian postcode at all.
- Symmetric, so it also catches an Australian on the US flow being charged USD with no GST, which
  is our own tax exposure rather than the studio's.

Blocked attempts are logged as `checkout_blocked_region_mismatch`, because a blocked studio is
otherwise a silently lost sale. **`activity_log.action` has a CHECK constraint and that value was
not in it**, so the insert would have failed inside the try/catch that exists so logging can never
break a checkout: silent. Migration `052` extends the constraint, rebuilt programmatically from its
own live definition rather than retyping 61 values (verified 61 -> 62, nothing dropped).

Verified: the guard returns `mismatch:true` on Neverland's exact stored values, `false` for a
genuine AU studio, and `false` when phone and postcode are both absent. The function's real select
string was run against the live row to prove `contact_phone` and `address_postcode` actually come
back, since a mistyped column would have made the guard silently never fire. Deployed; a bogus
session token still answers 401. Gate green, 56 `_shared` tests.

STILL OPEN, deliberately: `resolve-pricing` (the preview) is unguarded, so a NZ studio is shown AUD
pricing all the way to checkout and only stopped there. Correct on the money, poor on the journey.
`COUNTRY_TO_REGION` at `js/form.js:266` remains dead code and the dropdown stays removed, per Gary.

## 2026-08-26 (item 3): stripe-webhook redeployed, and it had never been type-checked

The handover said live was v49 and the unsubscribe commit landed 2 minutes later. Close: live was
**v51, deployed 2026-05-18 23:13:57 UTC**, and `e4f8ce2` was committed 23:15:03 UTC, **66 seconds
after**. So the live webhook genuinely predated the studio email opt-out work and had been running
roughly three months stale.

**A redeploy was not the one-line job it looked like.** `deno check` on `stripe-webhook` reported
**12 errors**, all TS2352: `event.data.object as CheckoutSession` and eleven siblings, because
`StripeEvent.data.object` was typed `Record<string, unknown>`, which TypeScript refuses to cast to
those shapes. The file had never been checked, because the deploy path does not run `deno check`.
Fixed at the source by typing it `unknown` (any cast from `unknown` is legal), with a comment saying
why so nobody helpfully narrows it back and reintroduces all 12. Both handlers that receive the
whole event already take `eventPayload: unknown`, so nothing else moved. Zero runtime change.

What the redeploy actually landed: 9 commits touching the import closure since v51, not just the
unsubscribe link. `e4f8ce2` (opt-out + unsubscribe footer), `8e9d4c1` (em dashes stripped from
customer-facing copy), `2a0f2bb` (mailgun attachment type fix), plus 6 others touching
`email-templates.ts`, `post-payment.ts` and friends.

Verified after deploy: v52 live, and an unsigned POST returns OUR body
(`Invalid signature: Missing Stripe-Signature header`, 400) rather than a gateway 401, so
`verify_jwt = false` survived. That probe is the one that matters here: `config.toml` carries the
setting, but the 2026-08-20 incident was a redeploy silently re-enabling it.

### The email opt-out cannot suppress a financial document, and now there is a test

Prompted by a question about whether a studio can unsubscribe from invoices. Checked rather than
assumed:

- **Invoices never reach our opt-out gate at all.** They are issued by Stripe with
  `collection_method='send_invoice'` and delivered by Stripe, not through Mailgun.
- **Receipts are essential.** `stripe-webhook` sets `studio receipt (immediate|hold|save card)` and
  all three are in `ESSENTIAL_INTENTS`, so `sendIfAllowed` always sends them.

The fragility is that `ESSENTIAL_INTENTS` is a hand-maintained Set matched by EXACT STRING EQUALITY,
and `studio-email.ts` says in its own comment to "grep for `intent:` to confirm coverage". A typo or
a rename silently downgrades a financial email to optional and an opted-out studio stops receiving
it, with nothing logged. So `_shared/essential-intents.test.ts` now scans every function source for
both spellings (`intent: 'x'` and `intent = 'x'`, the latter being how the webhook does it and the
reason a naive grep misses two of the three receipts) and fails on any intent that is neither
essential nor in a reviewed KNOWN_OPTIONAL list with a stated reason. Confirmed it actually bites by
injecting a bogus intent: it failed and named the file, then passed again on revert.

### PII

The Neverland owner's personal email address was committed to this PUBLIC repo's `IN-FLIGHT.md`
by 9bcb2dd (the prior session). Redacted to "the Neverland owner"; the studio name and submission id
are enough to work from, and it is not repeated here for the same reason. **It remains in git
history and the repo is public, so treat it as disclosed.** Also
caught before commit: the region-guard tests originally hard-coded her real mobile. They now use
fictional +64 numbers, with a comment saying why.

## 2026-08-26 (correction): the routing belongs at signup, and I built it in the wrong place

Gary's correction, and it was right. There are TWO commercial lines, Australia and everyone else,
and the studio's country arrives with the signup API payload, well before any form. So the routing
decision belongs at the signup seam. What I built first was a checkout-time BLOCK inferred from
phone dial codes and postcodes: the wrong mechanism, in the wrong place, producing a dead end that
told a paying studio to email us.

**The real bug was in the Connector.** `resolveFormRoute` looked region up in `REGION_ALIASES`,
which held only `au/aus/australia` and `us/usa/america/united states`. Anything else missed, the
function returned null, and BOTH callers HOLD with zero side effects: no token, no row, no invite,
no email, `200 {held:true}`. So at cutover a New Zealand studio would sign up, pay, and receive
nothing, with no record for anyone to notice. A test pinned the behaviour:
`expect(resolveFormRoute("nz", "launch")).toBeNull()`.

That is not a third line, it is silence, and it is the same failure shape as everything else found
today. Fixed: AU aliases resolve to `au`, EVERYTHING else resolves to `us`, and region can never
hold a signup. Only an unmappable `plan` still holds, because we cannot guess which product a studio
bought and a wrong-plan link is worse than a hold the platform re-fires. An ABSENT region also takes
the US line: not-known-to-be-Australian is the definition of the everyone-else line, and routing
someone visibly beats holding them where nobody looks.

Falling back by rule must not become the new silent path, so the route now carries
`regionSource: 'au' | 'us' | 'fallback'` and both callers log an unrecognised or absent region. That
surfaces an alias worth adding, or a platform field sending junk. Deployed with `--no-verify-jwt`
and probed (unsigned POST still answers our own body). 1094 tests. Connector `89a37e2`.

**The Onboarding guard was then demoted to what it should always have been:** a backstop for someone
who reaches a form directly, which is exactly how Neverland arrived. `create-checkout-session` no
longer blocks. It REPRICES onto the everyone-else line and lets them finish, logged as
`checkout_region_repriced` (052 updated; the earlier `checkout_blocked_region_mismatch` value is
left in the CHECK constraint, unused, with zero rows).

The correction is deliberately DOWNWARD ONLY. A non-Australian on the AU form is currently being
OVERcharged, so correcting silently only ever reduces what they pay. The reverse, an Australian on
the US form, would mean quietly ADDING 10% GST to a price they already saw, and charging someone
more without telling them is not a correction: that case keeps its explicit block.

STILL OPEN: `resolve-pricing` (the preview) does not derive, so a direct-link NZ studio would see
AUD in the form and pay USD at checkout. Only reachable by bypassing the invite link, since the
signup fix routes everyone else correctly, but it should be closed.

## 2026-08-26 (loose end closed): preview and checkout now derive the line from one function

Two corrections from Gary first, both of which I had wrong:

1. **Nobody is being "overcharged" by a crossing.** The AUD and USD catalogs carry independently set
   rates, not a conversion. Verified in `public.products`: AI/DFY is AUD 69900 against USD 54900,
   launch/DFY AUD 40000 against USD 29900. So landing on the wrong line is the wrong PRICE LIST, not
   a bigger bill, and the downward-only asymmetry I built on that premise was meaningless.
2. **Neither crossing should ever happen.** A non-Australian must never reach the AUD form and an
   Australian must never reach the USD form. There is no acceptable direction.

So `pricingCountryFor` is now SYMMETRIC: non-Australian on the AU form is priced on the everyone-else
line, Australian on the US form is priced on the Australian line. It still corrects rather than
blocks, because the right price is knowable from what the studio already told us.

**The loose end was that `resolve-pricing` did not derive at all.** It trusted a client-supplied
`country`, which is only ever whatever the URL implied, so a studio who reached /au/ directly would
be SHOWN AUD and CHARGED USD. It now accepts an optional `session_token`, loads the submission, and
runs the same `pricingCountryFor` that checkout runs. One function, same inputs, so the shown price
and the charged price cannot disagree. The token is optional and a non-matching token falls through
to the anonymous catalog view rather than erroring: this endpoint must never be able to stop a price
from rendering. `js/form.js` sends `session.token`; cache-buster bumped to `20260826a` on all six
`au|us/{launch,scale,ai}/index.html`. `door.css` deliberately left at `20260820a`, since it did not
change.

Verified: anonymous preview unchanged (AU -> AUD 69900 +10%, US -> USD 54900 +0%); the exact
session-hash lookup run against the live row returns `country=AU`, `contact_phone=+64...`,
`address_postcode=0632`, which `pricingCountryFor` turns into `US`. Functions deployed BEFORE the
push, since form.js ships via Pages on any push to main. Gate green, 65 `_shared` tests.

### Why no synthetic submission row was inserted to test this

`submissions` carries an **AFTER INSERT** trigger (`on-submission-trigger`) that POSTs to the
`on-submission` edge function, plus a `Sync-to-sheet` trigger. Inserting a throwaway row to test the
lookup would have fired a real admin notification. The lookup was proven against the existing row
instead, without writing anything.

### Security finding, pre-existing, NOT introduced here

`pg_get_triggerdef` for `on-submission-trigger` and `Sync-to-sheet` embeds a **service-role JWT in
plaintext** in the trigger definition. Anyone who can read `pg_trigger` (any DB read access) can
lift a service-role key from it. That is a stored credential in a readable catalog, and rotating the
service-role key would also silently break both triggers, since the old token is baked into the DDL.
Worth a deliberate fix: move the token to Vault and have the trigger read it, the way the cron jobs
now do. Not touched in this slice.

## 2026-08-26 (security): three trigger targets had no auth at all, one was an open email relay

Started as the tidy-up I recommended, moving a service-role JWT out of trigger definitions into the
Vault. Reading the surface turned up something considerably worse.

**Three triggers called edge functions with the token written as a literal in the trigger
definition**: `submissions/on-submission-trigger` -> `on-submission`, `submissions/Sync-to-sheet` ->
`sync-to-sheet`, and `messages/messages-notify` -> `notify-new-message`. That token sat in plaintext
in `pg_trigger`, readable with any database read access, and baked into DDL, so rotating the
service-role key would have silently broken all three.

**The real problem was that none of the three had ANY application-level auth.** Their only gate was
the gateway's `verify_jwt`, and that is not authentication here: the gateway accepts any validly
signed project JWT, and **the publishable key that satisfies it ships in the page source**.
Confirmed by probing all three with the public key: each answered with its own body, not a gateway
rejection.

`on-submission` then does `const row = payload.record || payload` and, for any record whose status is
not `draft`, sends to `row.contact_email`. So anyone who viewed source could make our server send
StudioLAB-branded mail from our authenticated Mailgun domain to any address they chose, with
template fields they controlled. An open relay. The sending reputation that would burn is the same
one every payment receipt depends on. Stripe mode is live, so the send path was active. Verified by
reading the code path, deliberately NOT by sending mail; the retest afterwards used
`@example.invalid`, a reserved non-routable TLD.

Two findings that made the sequencing non-obvious:

- The trigger's JWT does NOT match the current `SUPABASE_SERVICE_ROLE_KEY` (sha256 compared against
  the digest, false), and `isServiceRoleCaller` REJECTS it: posting it to `stripe-webhook-health`
  returned 403. It worked only because the gateway honours its signature. So "just add
  isServiceRoleCaller" would have broken all three instantly.
- There is therefore no zero-downtime ordering. Functions were deployed first and 053 applied
  immediately after; in that window the old triggers present the legacy JWT and are rejected, which
  is recorded in `net._http_response` rather than lost silently. Traffic is effectively nil.

Fixed: all three now require `CRON_SECRET` via `isCronCaller`, `config.toml` declares
`verify_jwt = false` for them (the gateway check was never load-bearing), and migration `053`
replaces the three triggers with `public.notify_edge_function()`, which reads the project URL and
CRON_SECRET from the Vault exactly as the cron jobs have since 050/051. It is SECURITY DEFINER with
a pinned `search_path`, and it returns without raising if the secrets are missing, because a
notification must never abort a studio's INSERT.

The webhook payload shape is preserved exactly (`type`, `table`, `schema`, `record`, `old_record`);
`sync-to-sheet` reads `old_record`, so that is not cosmetic.

Verified: no trigger definition contains a bearer token any more; forged POSTs with the public key
return 401 on all three; the real Vault path returns 200; and a draft row inserted into
`submissions` fired BOTH triggers, each returning `{"ok":true,"skipped":"draft"}`, which is the
no-email path. Test row deleted, one row left in the table.

### Still open on this surface

`sync-to-sheet` is separately broken and has been for a while: it 500s with
`SHEETS_WEBAPP_URL or SHEETS_SHARED_SECRET missing`. Only visible on non-draft rows, so today's
draft test skipped past it.

## 2026-08-26 (research): A2P, CNAM and alphanumeric sender IDs, and what it changed in the code

Researched the platform's Trust Center against Gary's two markets. Findings that mattered:

**The "simplified" A2P path is the revamped Trust Center**: a guided wizard with field checks and a
submission review, and once the BRAND is approved the CAMPAIGN is auto-submitted. It is guided, not
self-verifying; every submission still goes to vendor review, 3 to 7 business days.

**Two brand types, and which one a studio falls into changes what they need.** Standard (Low/High
Volume) needs a Tax ID (EIN in the US, Company Number/ACN in AU) and verifies by a 6-digit OTP to
the EMAIL address. Sole Proprietor is US/Canada only, for individuals with NO Tax ID and one
employee, verifies by text to a PERSONAL mobile (not a platform/CPaaS number, must reply YES), and
is limited to one phone number per campaign.

**Sole Proprietor registration REQUIRES a public-domain email.** Gmail and Yahoo are accepted;
Google Workspace and company email are REJECTED. `js/form.js` warned the exact opposite at every
studio, so a US sole trader who followed our advice would have had their registration refused.
`applyBusinessEmailWarning` is now conditional on country + business type and flips its advice for
that case, and `applyBusinessTypeConditionals` calls it so the advice updates when either changes.

**CNAM is not CNAME.** CNAME is the email sending domain (5 DNS records: 2 TXT, 2 MX, 1 CNAME, on a
subdomain). CNAM is Caller ID Name, and it is **US phone numbers only**, needs an EIN or DUNS, caps
at 15 characters and takes 48 to 72 hours to propagate. There is no Australian equivalent, and no
SHAKEN/STIR in Australia either. **The whole Trust Center left column is a US-market feature set**,
so Scale and Dominate AI genuinely deliver a thinner voice/SMS trust story in AU. Note the
interaction: a US sole trader with no EIN qualifies for the simplest A2P path and is exactly the
studio who CANNOT register CNAM.

**Alphanumeric sender IDs are not supported by the phone layer.** Open feature request since April
2020, still unaddressed, no official reply. More importantly they are ONE-WAY: no number sits behind
them, so no replies come back and opt-out has to run through an unsubscribe link. That would break
the lead inbox, missed-call text-back, AI over SMS, and the STOP language already in our A2P sample
messages. Since 1 July 2026 an unregistered alphanumeric ID to an AU mobile displays as
"Unverified", which is worse than sending from the number.

**Gary's decision: raw phone numbers, alphanumeric not worth chasing.** So the
`sender_id` field ("Preferred SMS Sender ID (AU only)") is removed from the `sms_a2p` tile and from
`studio-save-setup-task`'s allow-list, because collecting a preference we cannot honour sets a false
expectation. `setup_tasks` held zero rows with that key, so nothing was orphaned. The tile's
`whatWeDo` copy also claimed an "AU SMS sender ID system" that does not exist; rewritten to say AU
messages send from the studio's own number.

### Still open on this surface

- `sms_a2p` is one tile covering two different regulatory regimes. AU studios see US framing.
- No carrier outcome state: the task flow has no `rejected` and no rejection reason, and carrier
  rejection is common.
- `ssn_last` is a column nothing writes (`save-draft` refuses it deliberately). Dead PII, drop it.
- AU sole traders holding only an ABN may fall in a gap: Standard needs a Company Number, and Sole
  Proprietor is US/Canada only. Needs confirming against a live account.

## 2026-08-26: country is a SEPARATE axis from the commercial line

Gary's direction: everything country-specific, not just AU vs US. A UK studio pays on the
everyone-else line in USD AND is a UK business asked for a UK identifier. The two axes had been
conflated everywhere.

Two concrete consequences of that conflation, both found in code:

**The form asked non-AU, non-US studios for NO business identifier at all.** The gating was
`show('einField', isUS && ...)`, `show('abnField', isAU)`, `show('acnField', isAU && isPtyLtd)`.
There is no NZBN, no UK company number, no Canadian BN and no generic field. Standard A2P brand
registration requires a tax ID, so a New Zealand studio reaching SMS registration has nothing to
submit, and nothing in the flow surfaces it until it fails.

**The pre-bind threw the real country away.** `mapRegion` collapsed the signup's country hint to
`'AU' | 'US' | null` and `toIdentity` kept only that, so even though the raw country DOES survive
into the Connector's `inbound_signup.region`, the Onboarding side could never recover it.

Shipped:

- **`_shared/business-identifiers.ts`** + 8 tests. Country to the identifier that country issues:
  AU ABN (all) and ACN (companies only), US EIN (not sole traders, who register as a Sole
  Proprietor brand with no tax ID at all), NZ NZBN, UK company registration number (companies and
  LLPs only), CA Business Number, and a GENERIC field for everywhere else. An unknown country gets
  the generic field rather than nothing, which is the whole point. Shape warnings are advisory: a
  studio mistyping an ABN should be nudged, never blocked from paying.
- **`prebind.ts` keeps `identity.country`** alongside `region`, and `buildSeed` stamps it onto the
  submission under the existing no-clobber rule. `submissions.country` has no CHECK constraint, so
  it takes any country.
- **`mapRegion` no longer returns a third outcome.** It had the identical defect the Connector's
  `resolveFormRoute` had: anything outside the au/us aliases returned null. Now an AU alias gives
  `AU`, anything else gives `US`, and null is reserved for "the signup told us nothing", which is
  the only case where falling back to the URL is right.

Four existing prebind tests failed on the added field, correctly, and one of them was worth keeping
honest: "a fully-filled row must produce no write at all". Its fixture now carries a country so the
invariant still means something rather than passing by omission. Two new tests assert that a New
Zealand signup keeps `country: 'NZ'` while its line stays `US`, and that a signup with no country
seeds none rather than guessing. 75 `_shared` tests, up from 65.

### NOT YET CONSUMED, and this is the next slice

The model exists and nothing reads it. The form still renders the hardcoded EIN/ABN/ACN trio gated
on AU/US, so the hole is still open for NZ/UK/CA studios. Wiring it needs the identifier fields
rendered from `identifiersFor(country, businessType)` across the six form pages, plus an effective
country resolved from the submission (prebind) falling back to the dial code and then the URL.

Also still country-blind and worth the same treatment: the `businessType` options are one mixed
AU/US list (LLC, Corporation, Pty Ltd, Other Australian entity), so a UK studio picks from options
none of which fit; and the `sms_a2p` tile frames everything in US terms.

## 2026-08-26: the country axis reaches the form (identifiers and entity types)

`_shared/business-identifiers.ts` shipped earlier the same day and nothing
consumed it. The form still rendered three hard-coded fields, EIN / ABN / ACN,
gated on the AU/US commercial LINE, so every studio in New Zealand, the UK,
Canada or anywhere else was asked for NO business identifier at all. Standard
A2P brand registration wants the one their country issues, so they would have
reached SMS registration with nothing to submit, weeks later, with nothing in
the flow having said so. The entity-type list had the same defect one field
over: one mixed AU/US menu, so an Australian studio was offered LLC and a UK
studio picked from six options none of which fitted their company.

Both catalogues now come from that module, keyed on COUNTRY:

- Identifiers: AU `abn`+`acn`, US `ein`, NZ `nzbn`, UK `crn`, CA `bn`, and a
  generic `tax_id` for a country we hold no entry for. Filtered by entity type,
  so an Australian sole trader is asked for an ABN and not an ACN.
- Entity types: per country, in that country's words, with STABLE values.
  `sole_prop` reads "Sole Trader" in Melbourne and "Sole Proprietor" in Ohio.
  Added `ltd` and `llp`; `llp` counts as incorporated (a UK LLP holds a
  Companies House number).
- Migration `054` adds `nzbn`, `crn`, `bn`, `tax_id`. Applied by hand and
  verified against `information_schema`. `save-draft` allows all seven and is
  deployed. Cache-buster `?v=20260826c` on all six pages.

**js/form.js renders the fields, it does not carry three static divs.** The six
pages now hold one `#identifierRow` container. `identifierRow()` falls back to
the business-type row and `absorbLegacyIdentifierFields()` removes the old
blocks, so a browser holding a cached copy of the previous markup self-heals
rather than showing two inputs with one id. Values live in `IDENT_VALUES`, not
in the inputs, because the fields are rebuilt whenever the country or the entity
type moves.

**Three defects found in review, all in this slice's own code:**

1. `renderIdentifierFields()` early-returned when the field set was unchanged,
   so a returning AU studio hydrated into an unchanged set, never received their
   stored ABN, and the next autosave wrote the blank input back over the row.
   `syncIdentifierValues()` now runs unconditionally.
2. `identifierPayload()` sent all seven columns with the inapplicable ones
   nulled. That erases real data: a US sole proprietor who holds an EIN never
   sees the field, so the null would have wiped it. It now sends ONLY the
   identifiers on screen and omits the rest, which `save-draft` leaves alone.
   The cost is a stale value outliving a change of entity type. Untidy beats
   erased.
3. **Codex caught the one that mattered.** The three US-line pages still carry a
   country `<select>`, and `applyRegionDefaults()` pre-filled it with the region
   default `US` on first paint, before any draft hydrated. `getCountryValue()`
   read that select first, so the row country and the dial code were never
   reached and every studio on those pages resolved to US regardless of what
   their signup said: the whole slice would have been a no-op exactly where it
   was needed. The select is now a MIRROR of the resolution, and only counts as
   an answer once a `change` event proves the studio chose it themselves.

Order of evidence, now pinned by `form-country-resolution.test.ts`: the country
stamped on the row at signup, then an international dial code the studio typed,
then the URL region. `+1` is deliberately not evidence, since the US and Canada
share it and guessing US asks a Toronto studio for an EIN they do not have.

**Identifiers are OPTIONAL.** They previously took `data-required` when shown,
so a US LLC without their EIN to hand was blocked from continuing by a field
carrying no required marker, while the card above it said in as many words that
these are optional and can follow later. Behaviour now matches the copy and
Gary's direction: capture basics, take payment, talk to them afterwards.

**Two source-reading tests** keep the browser copy honest, because js/form.js
cannot import Deno source and this repo has no bundler.
`business-identifier-parity.test.ts` slices the catalogues and the pure
functions out of js/form.js, evaluates them, and runs both implementations over
a matrix driven by `catalogueCountries()` rather than a hand-written list. Both
tests were verified by mutation: inject a label or digit-count change, or
restore the select-wins ordering, and they fail.

Money surface checked, unchanged: `currencyForCountry` maps AU/AUS/AUSTRALIA to
AUD and everything else to USD, so resolving UK instead of US alters nothing a
studio pays. Resolving NZ on an /au/ page does change it, and deliberately:
`pricingCountryFor` already corrected that studio at checkout from the same
phone number, so this only makes the price SHOWN agree with the price CHARGED.

Gate: `deno check` on the touched functions, 97 tests in `_shared/` (75 before),
`node --check` on `js/form.js` and `admin/js/detail.js`.

## 2026-08-26: the SMS tile speaks the studio's country, and waits its turn

Same defect class as the business identifiers, one surface over. The Setup
Checklist's `sms_a2p` tile described ONE country's process to everybody. It
opened with "In the US that means registering your business with the 10DLC
carrier registry", then asked every studio for a US Campaign Registry industry
vertical, a US campaign throughput tier, and an opt-in screenshot for US
Toll-Free verification, and told them carrier approval takes 3-7 business days.
A studio in Manchester or Auckland read three fields of American telecoms
machinery that does not apply to them and waited on an approval nobody was
processing.

Two shapes now, not five, in `_shared/sms-registration.ts`:

- **US**: the 10DLC framing and the three registry-only fields, because we run
  that process and the claims are true there.
- **Everyone else**: "we set your automations up to text families from your
  studio's own number, one they can reply to, and we handle whatever
  registration your network asks for", then the three things every market cares
  about: consent, saying who you are, and opt-out working first time. Three
  fewer questions, none of them ones we could act on.

**No statute is named and no timeline is promised where we do not own one.** We
know the US process because we run it; for everywhere else the honest claim is
what WE do, not what the local rulebook says. A test asserts the non-US copy
carries no "10DLC", "Toll-Free", "IRS" or "N-N business days". **Canada is a
recorded uncertainty rather than a guess**: Canadian long-code A2P is vetted
through the same registry as the US by some providers, so it takes the generic
wording, which is true either way, instead of a US-shaped tile asking a Toronto
studio for fields they may not need.

Sample messages carry STOP everywhere (understood in all of these markets) and
HELP only in the US, where a carrier actually checks for it. US English for US
studios, Australian English for everyone else, so "enrollments" and "enrolments"
each go to the right reader.

**Resolved SERVER-side, and that is the point.** account.html is a plain page
with an inline script and no bundler, so the alternative was a hand-kept copy of
all this copy in the browser held together by a drift test, the way
`js/form.js` has to be. It is not necessary here: the account page always
fetches before it renders and a studio's country cannot change while they are
looking at it. So `get-studio-account` sends the resolved tile as
`sms_registration` and the page renders it. One definition, no mirror.
`studio-save-setup-task` sources its `sms_a2p` allowlist from the same module,
as the UNION of every country's keys, so a studio whose country resolves
differently between visits is never rejected at the door.

**Staging: the messaging tiles now wait behind the access pack.** Gary's call
was to hold them so a studio is not hit with SMS compliance on day one. The
trigger he named, "until the account is live", could not be used: account.html
hides the entire checklist at `status = 'active'` and the activation banner
tells the studio "you can safely close this tab; this onboarding portal is no
longer needed", so gating there would have made the tiles unreachable rather
than later. Honouring it literally meant rewriting the handover story, which is
his decision, so it went back to him with a recommendation and he took it. The
trigger is the access pack: `sms_a2p` and `whatsapp` appear once no base tile is
still `pending`. `submitted`, `no_account`, `in_progress` and `complete` all
count, because each is the studio having dealt with that tile; requiring
`complete` would hold their next step behind OUR queue instead of their own
work. A tile already started is never taken away, so a studio who submitted SMS
details before this existed keeps it. The decision lives in
`_shared/setup-surfaces.ts` rather than the entrypoint, per this repo's own rule
that logic inside an `index.ts` cannot be tested, and a test asserts the
entrypoint has not restated the surface lists.

The checklist says a further step is coming (`messaging_pending`), so the grid
does not silently grow by two tiles, and saving a tile now refetches instead of
re-rendering from local state, because that save can be the one that unlocks
them and only the server knows.

**Codex found the two that mattered, and one was not this slice's at all.**

- **The studio can self-edit their COUNTRY on account.html**, and the self-edit
  save re-rendered from local state. So a studio who corrected "United States"
  to "United Kingdom" kept the cached US model and was still asked for a US
  Campaign Registry vertical: the exact defect this tile was rebuilt to remove,
  reachable in two clicks. That path now refetches, which costs a round trip and
  nothing else, since `renderAccount` replaces the whole of `#acctRoot` anyway.
- **Ticking "I don't have this yet" destroyed everything typed in the tile**, on
  all eight surfaces, because that path posted an empty object and the endpoint
  REPLACES `data`. A studio who wrote an opt-in description and two sample
  messages, then ticked a box that was only ever about the policy URLs, lost the
  lot. The stored data is now seeded on both paths. Pre-existing, not introduced
  here, and fixed because we were in the code.
- Two findings were artefacts of a stale review bundle (the extraction of
  `setup-surfaces.ts` and the graceful-degradation fix had both landed after the
  copies were taken), and the raw-HTML step rendering came back clean.

**Three more, caught in this session's own review before Codex ran:**

1. A re-save destroyed stored values. `studio-save-setup-task` REPLACES
   `setup_tasks.data` rather than merging, and the tile posted only its rendered
   fields, so a non-US studio who had filled the US registry fields before they
   stopped being asked for would have wiped them by reopening and saving. The
   save handler now seeds from stored data first. Same rule as the identifiers
   slice: we write what we asked for and leave alone what we did not ask about.
2. The tile vanished rather than degraded. If the deployed function lagged the
   page, `sms_registration` would be absent, `tileMetaFor` returned null and
   `renderSetupTile` rendered nothing, so a required tile silently disappeared
   for Scale and AI studios. The grid tile now renders from local identity and
   the modal says to refresh.
3. `get-studio-account` had **58 type errors** and nobody had ever seen one,
   because deploys do not run `deno check` and this function had never been
   checked by hand. One cause: its `.select()` column list was built by string
   concatenation, and supabase-js can only parse that list at the type level
   from a SINGLE literal, so the row resolved to `GenericStringError` and every
   property read off it was an error. Now one template literal; a column-by-
   column diff against HEAD confirms nothing was lost (the only change is that
   `first_name` and `last_name`, listed twice, appear once).

**Gate widened.** It named `node --check js/form.js`, so `account.html`'s
~2,000-line inline script, the whole post-payment portal, shipped unparsed,
along with every file in `js/` and `admin/js/`. `scripts/check-inline-js.mjs`
now extracts and parses the inline blocks from every page that has them plus all
21 standalone scripts: 25 files. A syntax error in there is a blank page for a
studio who has already paid.

Also generalised: the WhatsApp tile asked every studio for an "ASIC extract",
which is an Australian regulator.

Gate: `deno check` on the three touched functions, 117 tests in `_shared/` (107
before this slice's staging tests, 75 at the start of the day), 25 client
scripts parse clean.
