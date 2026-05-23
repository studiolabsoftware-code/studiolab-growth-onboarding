# Onboarding Access & Compliance — Phase Prompts

Self-contained prompts for each phase of the onboarding access & compliance build. Drop the relevant phase prompt into any fresh Claude Code session to execute that phase. Plan source of truth: [onboarding-access-and-compliance-capture.md](onboarding-access-and-compliance-capture.md).

**Convention:** when a phase is completed, append the next phase's prompt to this file before closing the session.

---

## Phase 1 — Business details step in the onboarding form

**Status:** Ready to execute.

### Prompt — copy from here

> Implement Phase 1 of the onboarding access & compliance plan. Full plan is at `docs/onboarding-access-and-compliance-capture.md` — read it first for context, especially the "Tier 1 — in the onboarding form" section.
>
> **Scope of this phase only.** Add a new "Business details" step to the onboarding form. Do not touch the portal checklist, do not add access delegation fields, do not add SMS/A2P fields. That's Phase 2+.
>
> **What to build:**
>
> 1. **New form step**, inserted between Studio (Step 1) and Contact (current Step 2). Title: "Business details". Six fields:
>    - Legal Business Name — text, required
>    - Trading Name / DBA — text, optional (placeholder: "If different from legal name")
>    - Business Type — select: Sole Proprietor / LLC / Corporation / Partnership / Non-profit / Pty Ltd / Other Australian / Other
>    - Registered Business Address — replace the existing single-line `address` capture with structured fields: Street, City, State/Region, Postcode, Country (Country defaults from existing `country` field on Step 1, read-only)
>    - EIN (US only, conditional on Country=US and Business Type ≠ Sole Proprietor) — text, format `XX-XXXXXXX`, required when shown. For US Sole Proprietor, show a SSN last-4 field instead (mask immediately on blur).
>    - ABN (AU only, conditional on Country=AU) — text, 11 digits, required when shown. Also show optional ACN (9 digits) when Business Type = Pty Ltd.
>    - Business Email — text, required. Soft warning (not a block) if the entered domain matches gmail.com / hotmail.com / outlook.com / yahoo.com / icloud.com: "Heads up — Google, Meta, and US SMS regulators require a business-domain email (e.g. you@yourstudio.com) to register your account. You can fix this later in your portal, but expect to be asked for it."
>
> 2. **Apply to all six form variants** — `us/launch/index.html`, `us/scale/index.html`, `us/ai/index.html`, plus the AU equivalents under `au/launch/index.html`, `au/scale/index.html`, `au/ai/index.html`. Check those exist; if AU has a different structure, mirror the equivalent location.
>
> 3. **Schema changes** — new migration under `supabase/migrations/`. Add columns to `submissions`:
>    - `legal_business_name text` (replaces casual use of existing `legal_name`; keep `legal_name` for backward compat but stop writing to it)
>    - `trading_name text`
>    - `business_type text`
>    - `address_street text`, `address_city text`, `address_region text`, `address_postcode text` (keep `address` as a denormalised display field, populate from the structured fields)
>    - `ein text` (encrypted at rest — use pgsodium or pgcrypto; check what's already configured in this project; if neither, document the gap and store plain with a TODO)
>    - `ssn_last4 text` (same encryption treatment)
>    - `abn text`
>    - `acn text`
>    - `business_email text`
>    - `business_email_is_personal_domain boolean` (set true if matched personal domain list at submit — for admin filtering)
>
> 4. **Edge function whitelist** — extend `ALLOWED_FIELDS` in `supabase/functions/save-draft/index.ts` (lines ~20–37) to include the new fields. Verify no other function strips them.
>
> 5. **Review step** — extend the existing summary card on the Review step of each form to render the new Business details block.
>
> 6. **Admin detail view** — update `admin/js/detail.js` (and detail HTML if needed) to render the new Business details section. Mask EIN/SSN/ABN in the list view; show in detail.
>
> **Constraints:**
> - Don't introduce backwards-compat shims beyond keeping the old `legal_name` column. Stop writing to it; leave it readable.
> - No feature flags. Direct cutover.
> - Australian English in all UI copy.
> - Follow existing form styling (look at how the current steps render); don't introduce new component patterns.
> - Use the linked Supabase CLI to deploy migrations and edge functions yourself — don't hand Gary a checklist (per memory `feedback_run_deploys_and_sql.md`).
> - Verify by running through the form on a local server / preview deploy end-to-end with one US flow and one AU flow before reporting complete.
>
> **Done means:**
> - Form renders new step in all six variants
> - Conditional EIN/ABN/SSN logic works
> - Soft warning fires for personal email domains
> - Submission persists the new fields
> - Admin detail view shows them
> - Migration deployed
> - Edge functions deployed
> - End-to-end smoke tested
>
> **When done, append the Phase 2 prompt** to `docs/onboarding-access-phase-prompts.md` (this file) under a new "Phase 2 — Setup Checklist (DFY mode) in the portal" section. The Phase 2 prompt should be self-contained the same way this one is — referencing the plan doc, defining scope, schema, build steps, constraints, and done criteria. Use the plan's "Tier 2 — Setup Checklist in the portal" section as the source.

### End prompt

---

## Phase 2 — Setup Checklist (DFY mode) in the portal

**Status:** Ready to execute. Phase 1 shipped: business identity captured in the onboarding form before payment.

### Prompt — copy from here

> Implement Phase 2 of the onboarding access & compliance plan. Full plan is at `docs/onboarding-access-and-compliance-capture.md` — read it first for context, especially the "Tier 2 — Setup Checklist in the portal" section. Phase 1 (business identity captured in the form) is already shipped via migration `040_business_details.sql`.
>
> **Scope of this phase only.** Build the Setup Checklist surface in the portal for Done-For-You customers. Do not build the Guided-mode variant (that's Phase 3). Do not build the admin-side "claim and action a tile" workflow (that's Phase 4, out of scope).
>
> **What to build:**
>
> 1. **New table `setup_tasks`** in a new migration under `supabase/migrations/`. One row per submission per surface. Columns:
>    - `id uuid primary key default gen_random_uuid()`
>    - `submission_id uuid not null references public.submissions(id) on delete cascade`
>    - `surface text not null` — one of: `gbp` (Google Business Profile), `ga4` (Google Analytics 4), `gsc` (Google Search Console), `gtm` (Google Tag Manager), `google_ads`, `meta` (Facebook + Instagram), `tiktok`, `sms_a2p`, `whatsapp`
>    - `status text not null default 'pending'` — one of: `pending`, `submitted_by_studio`, `actioned_by_us`, `complete`, `not_applicable`
>    - `data jsonb not null default '{}'::jsonb` — surface-specific captured payload (IDs, URLs, samples)
>    - `dont_have_yet boolean not null default false` — branches the workflow to "we'll create it for you"
>    - `submitted_at timestamptz`, `actioned_at timestamptz`, `completed_at timestamptz`
>    - `created_at`, `updated_at` (with `update_updated_at` trigger)
>    - Unique constraint on `(submission_id, surface)`
>    - Index on `submission_id` and on `(status, surface)` for admin lookups
>    Seed one pending row per surface for every existing submitted row (so the checklist renders immediately for current studios).
>
> 2. **New edge function `setup-task-save`** under `supabase/functions/setup-task-save/index.ts`. Mirrors the save-draft pattern: takes `{ session_token, submission_id, surface, data, dont_have_yet, mark_submitted }`, validates the session token via `sha256Hex` and looks up the submission to confirm ownership, upserts the row, sets `status='submitted_by_studio'` and `submitted_at=now()` when `mark_submitted` is true. Returns the saved row. Deploy with `--no-verify-jwt` (same pattern as save-draft — uses session_token auth).
>
> 3. **New edge function `setup-tasks-list`** that returns all setup_tasks for a given submission_id (session-authenticated). Used by the portal to render the checklist.
>
> 4. **New portal tab `setup.html`** (or extend `portal.html` with a Setup tab — match whatever the existing structure prefers). Look at `portal.html`, `account.html`, `kb.html` for the established portal layout pattern. The Setup Checklist should:
>    - Render a header tile: **"Set up your accounts — X of 9 complete"** with a progress bar.
>    - Render 9 accordion tiles (one per surface). Each tile is collapsed by default; clicking expands it.
>    - Inside each tile, three sub-sections in plain non-technical language:
>      a. **"What we'll do for you"** — 1 sentence per surface (e.g. GBP: *"We'll manage your Google Business listing — update info, respond to reviews, post updates."*)
>      b. **"What we need from you"** — invite instructions (copy from `docs/onboarding-access-and-compliance-capture.md` "What we actually need to capture" section). Show our agency identifier with a one-click copy button. Include the input fields for IDs/URLs to paste in. Include a **"Save and continue later"** button (auto-saves but stays pending) and a **"I've done my part — let us take it from here"** button (marks `submitted_by_studio`).
>      c. **"I don't have this yet"** checkbox at the bottom — when ticked, hides the input fields and shows a single line: *"We'll create one for you as part of setup."* Saving in this state marks `dont_have_yet=true` and `status='submitted_by_studio'`.
>    - Each tile shows a status chip: `Outstanding` / `With us` / `Done` / `Not applicable` (colour per the existing admin chip patterns).
>    - Order tiles by status (Outstanding first, then With us, then Done) — drives attention to what's left.
>    - **Critically: the checklist is not a blocker.** The portal nav stays available. The studio can leave and come back. Progress persists.
>    - **The exact fields to capture per surface** are listed in the plan doc — implement them faithfully. SMS A2P tile is the heaviest (sample messages, opt-in screenshot upload, volume estimate) and uses the existing `submission_attachments` bucket pattern for screenshots.
>    - **Pre-fill compliant sample SMS** as default text in the two SMS sample fields. Use the language: *"Hi [Name], reminder: [Class] tomorrow at [Time] at [Studio]. Reply STOP to opt out."* and *"Term enrolments now open at [URL]. Reply STOP to opt out."* Studios edit, but the rejection-bait blanks are prevented.
>
> 5. **Surface-specific field shape** — implement these per-surface `data` jsonb structures (see the plan doc for full rationale). All optional unless the studio also tries to mark `mark_submitted=true`:
>    - `gbp` — `{ maps_url, place_id }`
>    - `ga4` — `{ measurement_id, property_id }`
>    - `gsc` — `{ property_url, property_type }`
>    - `gtm` — `{ container_id, account_id, site_platform }`
>    - `google_ads` — `{ customer_id, currency, time_zone }`
>    - `meta` — `{ business_manager_id, page_url, page_id, instagram_handle, instagram_is_professional, instagram_linked_to_page, ad_account_id, pixel_id }`
>    - `tiktok` — `{ business_center_id, ad_account_id, handle, handle_is_business }`
>    - `sms_a2p` — `{ optin_method, optin_description, optin_screenshot_url, sample_1, sample_2, estimated_volume, privacy_policy_url, terms_url }`
>    - `whatsapp` — `{ display_name, category, verification_doc_url }`
>
> 6. **Email nudge schedule** — new edge function `setup-tasks-nudge` invoked daily by a cron (use the existing pg_cron pattern if present, otherwise document a manual trigger). For each submission with outstanding tiles older than 2 days, 5 days, 10 days, then weekly thereafter, send a polite nudge email listing what's outstanding. Reuse the existing `email-templates.ts` + `email-gated.ts` infrastructure. Gate on `stripe_mode` like all other notification emails (memory: `project_email_gating_test_mode.md`). Respect the studio email opt-out (table `studio_email_optout` from migration 039).
>
> 7. **Admin inbox notification** — when a tile flips to `submitted_by_studio`, write to the existing admin inbox surface (migration 037 service_requests / 038 admin_notification_optout — reuse the same channel pattern). Subject line like: *"Smith Dance submitted their GA4 access — ready to action"*.
>
> 8. **Our agency identifiers — config** — add to the existing `payment_settings` table or a new `agency_settings` table: `agency_gmail` (default `studiolabsoftware@gmail.com`), `agency_meta_bm_id`, `agency_tiktok_bc_id`, `agency_google_ads_mcc_id`. Render these in the tile copy with copy buttons. Editable from admin (so we can swap when we provision real Business Manager / MCC accounts).
>
> **Constraints:**
> - Australian English in all UI copy.
> - Tile copy must be readable by non-technical studio owners. Avoid jargon ("MCC link", "delegated owner") unless paired with plain-language explainer.
> - All edge functions deploy with `--no-verify-jwt` (session_token auth pattern).
> - Use the linked Supabase CLI to deploy migrations and edge functions yourself.
> - Run migration via `cat <migration> | supabase db query --linked` (the CLI's `db push` rejects the project's non-timestamped migration names).
> - Reuse existing component patterns from `portal.html`, `account.html`, `admin/`. Match the visual language (cards, chips, brand colours via CSS vars).
> - Don't build the admin-side action workflow (claim, do the work, mark complete, notify studio) — that's Phase 4. Submitted tiles sit in `submitted_by_studio` state waiting for us.
> - Verify by serving the portal locally and walking through at least 3 tiles end-to-end (fill, save partial, mark submitted) before reporting complete.
>
> **Done means:**
> - `setup_tasks` table created and seeded
> - `setup-task-save` and `setup-tasks-list` functions deployed
> - Portal Setup tab renders all 9 tiles with progress bar
> - Each tile: "what we'll do", "what we need", "I don't have this yet" branch all working
> - Status chips update live as tiles are saved/submitted
> - Pre-filled compliant sample SMS in the SMS tile
> - `setup-tasks-nudge` deployed with the day-2/5/10/weekly schedule
> - Admin inbox receives notification on first submission of a tile
> - Agency identifiers configurable from admin
> - Static smoke walk-through verified on at least 3 tiles
>
> **When done, append the Phase 3 prompt** to `docs/onboarding-access-phase-prompts.md` under the "Phase 3 — Self-serve guide (Guided mode) layer" section. Phase 3 builds the Guided-mode variant on top of the same tile components: same data shapes, different copy framing ("what *you* need to do"), plus a new "what you'll need before you start" block per tile.

### End prompt

---

## Phase 3 — Self-serve guide (Guided mode) layer

*To be authored when Phase 2 is complete.*

---

## Phase 3 — Self-serve guide (Guided mode) layer

*To be authored when Phase 2 is complete.*
