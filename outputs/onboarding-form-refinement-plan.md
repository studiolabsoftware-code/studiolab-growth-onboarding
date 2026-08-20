# Onboarding form refinement — build plan (pre-go-live)

Status: PLAN (2026-07-23). Tier-2 (live production form on shared prod DB).
Canonical spec: `Growth Connector/docs/plans/old-form-refinement-spec.md`.
Decision record: growth-connector `docs/DECISIONS-HISTORY.md` 2026-07-23 "Onboarding consolidation".

## Structural principle (the one rule)

Ask for a field only if we won't reliably have a real VALUE for THIS studio at form time.
Pre-fill the six the signup webhook gives us (name, email, company, plan, tier, region);
genuinely ASK for what Growth needs but we don't have (website, address, branding, voice,
socials); for technical/regulated items capture the INFO, don't make the studio do the SETUP.

## Cross-system contract (DO NOT BREAK)

The Growth Connector READS `public.submissions` by an explicit column-name allow-list.
- ADDING columns/fields is safe.
- Do NOT rename/drop any Connector-read column (studio_name, legal_business_name, trading_name,
  business_type, abn, acn, plan, setup_type, region, country, timezone, status, payment_status,
  amount_paid_cents, currency, paid_at, address*, first_name, last_name, contact_email,
  contact_phone, business_email, website, support_url, logo_url, primary_colour,
  secondary_colour, sign_off, email_tone, footer_notes, studio_description, from_name,
  reply_email, brand_reference_url, custom_domain, email_domain, sms_type, area_code, sms_tone,
  facebook_url, instagram_handle, tiktok_handle, youtube_url, google_business_url, booking_url).
- When we STOP collecting a field (sms_type, area_code): just stop writing it; LEAVE the column.
- Dropping dns_access from the form is fine (Connector never reads it).
- Do NOT touch the Stripe/payment flow. EIN/SSN handled exactly as today (masked, never logged).

## Current-state facts (verified in code, 2026-07-23)

- Form: static HTML/JS. Routes `au|us / launch|scale|ai / index.html`; logic in `js/form.js`
  (2542 lines); persists via edge fn `save-draft` (has an ALLOWED_FIELDS write allow-list).
- Validation (`validatePanel`) blocks a step only on visible `[data-required]` fields →
  making a field optional = remove `data-required`.
- Prefill: after OTP, `verify-otp` seeds a draft with ONLY contact_email + plan + region;
  `hydrateFromSubmission` already maps first_name/last_name/studio_name/contact_email IF present.
  → contact_email/plan/region prefill today; first_name/last_name/studio_name are NOT carried
  (no signup pre-bind draft exists). FOLLOW-UP, not a blocker (see below).
- `dns_access`: already absent from all 6 HTML files; only a dead payload write remains.
- SMS: Scale/AI only (tier-gated). Currently smsType select + hasTwilio + twilioRow + portRow.
- `submissions` has no general JSONB column → consent needs a small ADDITIVE migration.

## Success criteria (Definition of Done)

1. Only hard-required field is business name (studio_name, pre-filled). Everything else
   optional-but-encouraged. No step blocks on anything else.
2. Branding / voice / socials kept + prominent; socials reframed to "see your style & tag you"
   with a "connection happens together during setup" line.
3. DNS self-assessment gone; domain card is a simple optional info-capture (keep custom_domain
   yes/no + email_domain). Dead dns_access write removed (column retained).
4. SMS collapsed to one yes/no intent + optional sms_tone in the Yes branch. sms_type / area_code
   no longer written (columns retained). has_twilio/twilio_number/port_number UI retired from form.
5. Legal/tax (legal_business_name, business_type, abn/acn, ein/ssn_last4) kept but optional +
   region-appropriate + one-line "why we ask" (US texting-number registration). Never blocks submit.
6. Send-on-behalf consent checkbox added at the review step. WORDING routed to Gary/compliance —
   not free-handed. Persisted auditably (consent_send_on_behalf + consent_captured_at + version).
7. Order tuned for momentum (warm/short first, technical/optional last) WITHOUT re-architecting
   the wizard or moving payment (payment stays terminal). Surgical, not a rebuild.
8. Breaks no Connector-read column. Passes green gate (JS syntax + Playwright AU+US smoke).
   Payment untouched.

## Scope decisions (tech-lead calls)

- **Reorder = surgical, not step-rearchitecture.** The wizard's step framework, autosave
  step-tracking (`last_step_completed`), step pills, ARIA, and terminal payment step stay intact.
  We honour the spec's momentum intent by (a) framing step 1 as the warm pre-filled confirm,
  (b) demoting the heavy legal/tax block from its current up-front required position to
  optional + explained, and (c) keeping branding/voice ahead of legal/tax. A full
  confirm→brand→voice→socials→domain→sms→legal→consent re-sequence of panels is a rebuild and
  is explicitly out of scope.
- **US-only legal/tax:** interpret as "clearly optional, explained as US A2P-driven"; keep the
  existing region conditionals (EIN/SSN on US via businessType; ABN/ACN on AU). Not hard-hidden
  on AU because ABN/ACN are AU registry inputs.
- **Consent storage:** one additive migration (nullable columns) + one ALLOWED_FIELDS entry.
  Additive is contract-safe. Ships paired with the human-approved wording (both gate together).

## Follow-up to flag (out of scope here — needs backend/webhook work)

Pre-filling first_name / last_name / studio_name requires the signup path (GHL → StudioLAB)
to pre-bind a draft `submissions` row carrying those values before the onboarding link is
opened. Today `verify-otp` creates a bare draft. Until that pre-bind exists, those three show
as empty "please confirm" fields rather than pre-filled. contact_email/plan/region prefill now.

## Build slices

- Slice 1 (safe refinements): de-require; domain reword + drop dead dns_access; SMS collapse;
  socials reframe; legal/tax optional+explained; step-1 confirm framing. All 6 HTML + form.js.
- Slice 2 (consent, gated on wording): checkbox UI + client wiring + additive migration +
  allow-list entry + finalize path.
- Review: Codex challenge/review + business-logic & gap critics on the diff.
- Green gate: `node --check js/form.js`; Playwright end-to-end smoke of one AU + one US route.

## Build complete (2026-07-23) — committed on wip/onboarding-form-refinement (8f124eb), pushed

All of Slice 1b + Slice 2 built, adversarially reviewed (Opus + Sonnet critics), green
(node --check + static structural + deno typecheck of the two edited edge-fn TS files).
Codex review and the live browser smoke could NOT run in the build sandbox (network /
loopback / file:// blocked). The Playwright browser CAN reach external HTTPS, so the live
form is smoke-testable post-deploy.

Critic fixes applied: consent gates finalize only (not save-later); sms_tone cleared when
texting toggled off; admin email digest + admin detail page surface "Set up texting?" +
a Consent section; server-side consent guard added to save-draft finalize. Deliberately
NOT done this wave: consent guard in create-checkout-session (would reject in-flight
old-frontend payments during the transition window — sequence it as a fast-follow once all
sessions are on the new frontend). Payment/Stripe otherwise untouched.

## DEPLOY RUNBOOK (prod writes are gated by the harness safety classifier — run in order)

Migration history on prod is out of sync, so `supabase db push` is unsafe. Apply the
idempotent migration directly. Order matters: columns first, then save-draft (so the new
columns persist and are accepted), then the frontend.

1. Migration (additive, idempotent):
   `supabase db query --linked -f supabase/migrations/044_consent_and_sms_intent.sql`
   verify: `supabase db query --linked -o table "select column_name from information_schema.columns where table_schema='public' and table_name='submissions' and (column_name like 'consent%' or column_name='sms_setup_requested') order by column_name;"`
2. Edge functions (save-draft is mandatory: new ALLOWED_FIELDS + server consent guard;
   on-submission for the updated admin digest):
   `supabase functions deploy save-draft`
   `supabase functions deploy on-submission`
3. Frontend to prod (GitHub Pages serves app.studiolabgrowth.com from main). Lands 3
   commits: handover-rule, Slice 1a, Slice 1b+2:
   `git checkout main && git merge --no-ff wip/onboarding-form-refinement && git push origin main`
4. Post-deploy: Playwright `?preview=1` smoke of one AU + one US route on the live URL
   (steps navigate, consent gate blocks submit until ticked, 0 console errors).

Follow-ups (not blockers): create-checkout-session consent guard (sequenced); Growth
Connector read-RPC to surface sms_setup_requested + consent; in-flight pre-deploy drafts
lose old SMS preference display on re-entry (rare); pre-existing _shared/mailgun.ts:50
Deno type-strictness error (unrelated, doesn't block deploy).
