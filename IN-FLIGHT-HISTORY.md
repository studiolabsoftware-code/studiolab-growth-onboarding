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
