# StudioLAB Growth Onboarding: Session Handover

You're picking up a partially completed build of the StudioLAB Growth onboarding platform. The project brief lives at the repo root in `HANDOVER-PROMPT.md`. Read that brief in full first — it's the source of truth for scope, schema, plan logic, and design rules. **This document tells you only what's already done and where to resume.**

---

## Pre-Build: Reload Required Skills (do this first)

Before touching any code, load these skills via the `Skill` tool:

1. `ruflo` — already loaded last session, reload it.
2. `studiolab-design` — and **read all six reference files**:
   - `references/tokens.md`
   - `references/components.md`
   - `references/panels-and-drawers.md`
   - `references/cross-platform.md`
   - `references/ux-quality-gates.md`
   - `references/changelog.md`
3. `frontend-design` — this is the "UX/UI Design Pro Max" referenced in the brief.

Load `ux-copy` when writing user-facing strings, `accessibility-review` before marking any UI phase complete, and `email-campaigns` when writing email templates.

The StudioLAB design system overrides anything that conflicts with it. Hard bans: no em dashes (—) in any UI text, no teal, no uppercase buttons, no coloured borders on cards, no `text-[11px]` outside Reports tables. Magenta = action only, never decoration. Indigo = brand/nav/links. Inter font throughout.

---

## Infrastructure Decisions (already made)

Gary doesn't have Supabase, the subdomain, or Mailgun set up against this project yet. He explicitly said: **"Build everything first and then we'll connect this all in later."** So:

- **Subdomain default:** `setup.studiolab-crm.com` (set in `CNAME`). Easy to change later.
- **Mailgun sending address:** `growth@studiolabsoftware.com`. Gary will verify `studiolabsoftware.com` in Mailgun separately.
- **Supabase:** doesn't exist yet. All Supabase config lives in `js/supabase-config.js` with placeholder values. Gary fills these in once the project exists.
- **Admins:** owner is `studiolabsoftware@gmail.com` (seeded in migration). VA email skipped for now. The schema supports adding more admin users later via plain INSERT.

Do **not** ask Gary to confirm any of these again. Build with placeholder credentials.

---

## What's Done

### Project structure (complete)
```
/Users/gary/Claude_Projects/Growth - Onboarding/
├── index.html                  ✅ Public form (8 steps), uses external CSS/JS, Supabase SDK linked
├── robots.txt                  ✅ Disallow: /
├── CNAME                       ✅ setup.studiolab-crm.com
├── .gitignore                  ✅
├── HANDOVER-PROMPT.md          ← original brief (read this first)
├── HANDOVER-NEXT-SESSION.md    ← you are here
├── css/
│   └── form.css                ✅ StudioLAB tokens applied, responsive, 44px touch targets
├── js/
│   ├── supabase-config.js      ✅ placeholder URL/anonKey, exports initSupabase()
│   ├── form.js                 ❌ NOT YET WRITTEN — your first task
│   └── update.js               ❌ NOT YET WRITTEN
├── update.html                 ❌ NOT YET WRITTEN
├── admin/                      ❌ entire admin app NOT YET WRITTEN
│   ├── index.html
│   ├── css/admin.css
│   └── js/{auth.js,dashboard.js,detail.js,change-request.js}
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql   ✅ All tables, RLS, trigger, storage bucket, owner seed
│   └── functions/
│       ├── on-submission/          ❌ NOT YET WRITTEN
│       ├── send-change-request/    ❌ NOT YET WRITTEN
│       ├── on-change-completed/    ❌ NOT YET WRITTEN
│       └── _shared/                (empty, for shared types/helpers if useful)
```

### Key implementation notes from work done so far

- **CSS tokens** (`css/form.css`) match the StudioLAB design system: `--mg #E8197F`, `--in #4A3F8A`, `--in-d #13102E`, `--g1 #F2F3F7`, `--g2 #DFE0EC`, `--g4 #9B9DB8`, `--g6 #4A4C65`. Semantic colours updated to design system values (ok=#047857, warn=#B45309, info=#0284C7, crit=#B91C1C).
- **Buttons** in CSS use `border-radius: 999px` (rounded-full equivalent), Title Case copy in HTML, never uppercase, `min-height: 44px` for touch.
- **HTML** has been refactored from the source form to use `data-action`, `data-yn`, `data-toggle`, `data-required` attributes. **All `onclick=` and `oninput=` inline handlers were removed** — the form.js you write must wire everything up via event delegation on these data attributes (see "form.js spec" below).
- **Honeypot** field `#hp-company` is included in step 8, hidden visually via `.hp` class. form.js must reject submission when it's filled.
- **Submission reference** placeholder `#done-ref` is in the confirmation screen. Display the first 8 chars of the inserted submission's UUID, uppercase.
- **Field IDs** that changed from source: `role` → `contactRole` (avoided collision with submissions.role column meaning), `slEmail` (StudioLAB login email — maps to `studiolab_email` column).

### Database schema (complete, see `001_initial_schema.sql`)
- All 5 tables created with constraints and indexes
- RLS enabled and configured per the brief
- `updated_at` trigger on `submissions`
- Storage bucket `logos` created (private, anon insert, authenticated read)
- Seeded `studiolabsoftware@gmail.com` as owner admin

One deviation worth noting: `change_requests.token` was renamed to `token_hash` in the schema. Store `sha256(rawToken)` on insert; the Edge Function looks up by hashing the incoming token from the URL. The raw token only ever lives in the email URL.

---

## What to Build Next (in order)

### 1. `js/form.js` (Phase 1 finish) — START HERE

This file owns all form behaviour. Wire up:

- **Event delegation** on `data-action` attributes: `next`, `prev`, `submit`, `add-faq`, `del-faq`.
- **Plan selection**: clicking a `.plan-card` updates `state.plan`, toggles `.sel`, calls `applyPlanVisibility()`. Plan card has `data-plan="launch|scale|ai"`.
- **Setup selection**: same pattern with `.setup-card` `data-setup="dfy|guided"`.
- **Step nav clicks**: clicking `.sp[data-s="N"]` calls `goTo(N)`.
- **Y/N buttons**: `.yn-b[data-yn][data-val]` — update `state.yn[key]`, toggle classes, show/hide `#{key}Cond` reveal.
- **Toggle checkboxes**: `.tg[data-toggle]` click toggles `.chk` and the inner checkbox `checked`.
- **Plan-conditional visibility**: replicate `applyPlanVisibility()` from the source form exactly. Plan-specific data collection is non-negotiable — see brief's "Plan-Specific Onboarding Requirements" section. Launch must send NULL for SMS and AI fields. Scale sends NULL for AI fields. Active workflows must only include what's visible AND checked.
- **Colour sync**: `#col1p ↔ #col1t` and `#col2p ↔ #col2t`. Validate hex format.
- **FAQ repeater**: add/delete rows. Keep at least 1 row.
- **Per-step validation**: before `next()` advances, check all `[data-required]` inputs/selects in the current panel. Show `.field-err` via `.has-error` class on `.f`. Email format via regex. URL format via try/catch on `new URL(v)`.
- **Logo upload to Supabase Storage**: on file input change, immediately upload to `logos` bucket with a random UUID-prefixed filename, store the public URL (or signed URL) in `state.logoUrl`, show `.fu-spin` while uploading, then `.fu-name`. Block submit if upload is mid-flight.
- **Summary build** on entry to step 8: replicate the source form's `buildSummary()`, formatting plan/setup labels, filling all `#sv-*` spans.
- **Submit**:
  1. Check honeypot — if filled, fail silently (pretend success).
  2. Disable submit button, swap label to `<span class="spinner"></span> Submitting...`.
  3. Build the payload object (plan-conditional — see brief).
  4. Collect `active_workflows` as JSON array of checked workflow values that are currently visible.
  5. Collect `lead_sources` similarly (Scale+ only).
  6. Collect `kb_faqs` as `[{question, answer}]` array, filter out empty pairs.
  7. `supabase.from('submissions').insert(payload).select('id').single()`.
  8. On success: show done screen with `id.substring(0,8).toUpperCase()` as ref, hide form/nav.
  9. On error: show `#submitErr`, re-enable button, log to console.

The source form's logic for `applyPlanVisibility()`, `selPlan`, `selSetup`, `yn`, `togChk`, `ct/cp` colour sync, `addFAQ/delFAQ`, `buildSummary` is all in `/Users/gary/Documents/Claude/Projects/StudioLAB Growth onboarding/growth-onboarding-form.html` (lines 1014–1198). Port it faithfully but switch to event delegation and add validation + Supabase wiring.

### 2. `update.html` + `js/update.js` (magic link update page)

Standalone page. URL is `/update.html?token=RAW_TOKEN`.

Flow:
1. Extract `token` from URL.
2. Call Edge Function `send-change-request`'s sibling — actually, simplest is an Edge Function called `validate-change-request` that takes the raw token, hashes it, looks up the row, checks expiry/status, and returns the submission row + the `fields` array. **Or** do this client-side: anon RLS policy on `change_requests` lets you SELECT where `token_hash = sha256($1) AND token_expires_at > now() AND status IN ('sent','opened')`. The brief allows either approach — go with the Edge Function path, it's cleaner and avoids exposing the hashing logic.
3. If invalid: show "This link has expired or has already been used."
4. If valid: render only the requested fields (subset of the form), pre-filled with current values from the submission.
5. Show admin's `message` at the top.
6. On save: PATCH the submission via another Edge Function (`apply-change-request`) that uses the service role key. Update fields + mark request `completed` + insert `activity_log` + trigger `on-change-completed`.

Use the same StudioLAB tokens. Share `form.css` where possible.

### 3. Edge Functions

All three plus the two helpers above. Mailgun calls go via the HTTP API: `POST https://api.mailgun.net/v3/{DOMAIN}/messages` with Basic auth `api:{MAILGUN_API_KEY}`. Set the following env vars in the Supabase Edge Functions dashboard:

- `MAILGUN_API_KEY`
- `MAILGUN_DOMAIN` (e.g. `studiolabsoftware.com` or whichever Gary verifies)
- `MAILGUN_FROM` (e.g. `StudioLAB Growth <growth@studiolabsoftware.com>`)
- `APP_URL` (e.g. `https://setup.studiolab-crm.com`)
- `ADMIN_APP_URL` (e.g. `https://setup.studiolab-crm.com/admin/`)

Trigger `on-submission` via a Supabase Database Webhook on INSERT to `submissions` (configure in dashboard, point at the Edge Function URL with the service role auth header). Same approach for `on-change-completed` but only fire when `change_requests.status` transitions to `completed` — use a trigger that calls `pg_notify` or just call the Edge Function directly from `apply-change-request`.

Email template style: StudioLAB Growth dark header (indigo-900 background, magenta SL mark), white body card, indigo CTA button. Use the `email-campaigns` skill for templating.

### 4. Admin Dashboard (`admin/`)

Single-page app, vanilla JS. Structure:
- `admin/index.html` — wraps everything. Two views: login and dashboard, toggled by `supabase.auth.getSession()` on load.
- `admin/css/admin.css` — extends form.css tokens. Table with magenta header (white uppercase column labels), filter pills with `h-7 rounded-full`, status badges, plan badges.
- `admin/js/auth.js` — `signInWithOtp({ email })` flow. Check `admin_users` table allowlist *before* calling OTP. On verify, store session, render dashboard.
- `admin/js/dashboard.js` — submissions list with filter/sort/search/realtime subscription on `submissions` table.
- `admin/js/detail.js` — detail view with collapsible sections, status/assign controls, notes, activity timeline.
- `admin/js/change-request.js` — modal: pick fields + message + send. Calls Edge Function.

Plan-aware display: badge at top, "Not included in [plan] plan" for SMS/AI sections when empty, field selector in change request modal only offers fields relevant to the studio's plan.

### 5. Polish (Phase 5)
- Sweep all copy for em dashes (—) and AI filler. Use `ux-copy` skill.
- Run `accessibility-review` skill.
- Test golden path end-to-end (form → email → admin → change request → studio update → completion).
- Add error handling for expired tokens, double submits, network failures.
- Write a `README.md` setup guide for Gary: how to create the Supabase project, run the migration, set Mailgun env vars, point the CNAME, seed an extra admin, etc.

---

## Hard Rules Recap

- **No em dashes** in any UI string. Use commas, full stops, colons, semicolons, or restructure. The brief and source form already had a few; sweep before shipping.
- **Buttons**: Title Case, font-semibold, rounded-full, never uppercase, min 44px touch target.
- **Cards**: white background, `border #DFE0EC`, no coloured borders on wrappers.
- **Tables**: magenta header, white uppercase column labels.
- **Plan-conditional data collection** is non-negotiable. Launch users must not have SMS or AI fields submitted. Scale users must not have AI fields submitted. The brief is explicit on which workflow IDs land in `active_workflows` per plan.
- **`noindex, nofollow`** meta on every HTML page.
- **Honeypot** on the public form, anon RLS limits write surface.

---

## Files to Reference

- Original brief: `/Users/gary/Claude_Projects/Growth - Onboarding/HANDOVER-PROMPT.md`
- Source form (canonical reference for step structure + plan logic): `/Users/gary/Documents/Claude/Projects/StudioLAB Growth onboarding/growth-onboarding-form.html`
- StudioLAB design skill base: `/Users/gary/.claude/skills/studiolab-design/`
- Current project root: `/Users/gary/Claude_Projects/Growth - Onboarding/`

Resume by reloading skills, then writing `js/form.js`.
