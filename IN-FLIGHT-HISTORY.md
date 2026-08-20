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

## Earlier

- Onboarding form refinement: optional fields, SMS collapse, consent, honest copy.
- Socials retirement: pasted `facebook`/`instagram`/`tiktok`/`youtube` handles gone
  from all six routes. Facebook as a *lead source* on Scale and Dominate AI stands.
