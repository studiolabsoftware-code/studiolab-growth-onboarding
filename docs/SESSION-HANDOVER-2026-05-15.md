# Session Handover — 2026-05-15

**Last commit on main:** `b44bd2c` Submission attachments: backend + admin UI (phase 1)
**Branch:** `main` (GitHub Pages auto-deploys static surfaces)

> This is a session-specific handover. The general onboarding brief is `HANDOVER-NEXT-SESSION.md`. Read both before resuming.

---

## State of play

Quote-to-invoice flow is shipped + audited + Block 1/2 fixes applied. System is **live-ready** subject to two manual steps below.

### What landed this session

- Full quote lifecycle: create, send, accept, decline, expire, cancel, revise
- PDF download proxy (admin + studio paths) — Stripe doesn't expose a public PDF URL for quotes, so we stream via `get-quote-pdf`
- Reminder cron (day-7 nudge, expiry-minus-5 warning, auto-cancel) via pg_cron + Supabase Vault
- Admin Quote modal + per-studio Quotes panel
- Studio account.html Quotes section + PDF download
- Catalog Copy URL button on every price box
- Pricebox layout fix so AUD/USD action rows align
- Custom-invoice GST: switched from `automatic_tax` to manual AU GST rate (matches checkout-session + create-quote)
- Server-side currency/country validation (AU → AUD/GST, overseas → USD/no-GST)
- JWT signature-verified service-role auth (HS256 against `SUPABASE_JWT_SECRET`)
- Stable payload-hash idempotency keys (no more `Date.now()`)
- Modal ESC + focus trap + focus restore via `AdminModal.attachDialogHygiene`
- Status pill semantics across admin + studio (Cancelled red, Expired grey, Sent blue)
- Error-string sanitisation across all user-facing endpoints
- 5 parallel audits run (code-quality, security, UI/UX + a11y, brand + copy, functional)

### Pending immediate action

**1. Redeploy 6 edge functions** so the audit fixes take effect:

```bash
supabase functions deploy stripe-webhook        --no-verify-jwt
supabase functions deploy create-quote          --no-verify-jwt
supabase functions deploy create-custom-invoice --no-verify-jwt
supabase functions deploy cancel-quote          --no-verify-jwt
supabase functions deploy get-quote-pdf         --no-verify-jwt
supabase functions deploy quote-reminders       --no-verify-jwt
```

GitHub Pages auto-deploys the static surface changes (admin/, account.html).

**2. Confirm `SUPABASE_JWT_SECRET` env var is set on Edge Functions.**
Supabase auto-injects this in normal projects but it's worth verifying via `supabase secrets list`. Without it, `isServiceRoleCaller` falls through to path 1 only (exact env match against `SUPABASE_SERVICE_ROLE_KEY`) — which still works for pg_cron but is more brittle.

---

## Critical follow-ups before live cutover

### A. Verify AU GST attachment on Stripe Quotes (manual sandbox test)

The audit flagged that `price_data.tax_behavior='exclusive'` combined with sibling `tax_rates=[id]` on a Stripe Quote line item may conflict (Stripe docs are ambiguous). See the VERIFY AT LIVE CUTOVER block in `supabase/functions/create-quote/index.ts` around line 254.

**Test procedure:**
1. Issue one AUD quote in test mode against a Gmail alias
2. Open the Stripe-sent quote email and view the hosted quote page
3. Confirm the breakdown shows three lines: Subtotal, GST 10%, Total

If GST is missing from the breakdown, the `tax_rates` attachment is being ignored. Mitigation already coded — set `useFallbackGst = true` for AUD permanently in `create-quote/index.ts`, which bakes 10% into `unit_amount`. Recipient still pays the GST-inclusive total either way.

### B. End-to-end test across all 12 product combinations

With the dapdev01 test data cleared (you ran the DELETE SQL last session), use 12 fresh Gmail aliases — one per plan × region × setup combination:

For each: issue quote → check email → accept → pay → verify both admin Invoices panel and studio account.html Invoices show the paid invoice → verify Quote pill is green (Accepted) on both sides.

Reference: catalog Copy URL buttons on the admin Catalog tab give you the right entry URL for each combo.

### C. Then start Phase 2: Live cutover prep

Still TODO. Scope:
- Audit every email-sending function for the `stripe_mode` test/live gate (memory: `project_email_gating_test_mode`)
- Verify Stripe Tax registration is set up (Stripe Dashboard → Tax → Registration → AU GST)
- Confirm business address + ABN on Stripe account
- Write a one-shot cutover script that flips `stripe_mode` in `payment_settings` to `live`, with a rollback path
- Smoke test against live mode with one $1 test transaction before opening the gates

---

## Phase 2 of submission attachments — pending

The backend (migration 020, four edge functions, daily cleanup cron) and the
admin UI for attachments are shipped and live as of `b44bd2c`. The two
remaining surfaces to wire are studio-facing:

### 1. Form upload widget on the onboarding form

**Where:** `js/form.js` (~2300 lines) and the per-region/plan form pages
(`au/launch/index.html`, `au/scale/index.html`, etc.)

**Scope:**
- Add a new form step / section for attachments. Logical placement: after
  "Additional notes", before the final review step.
- Drag-and-drop zone + file picker. Multi-select, max 5 files per
  submission, 25 MB per file, mime allowlist matching the edge function:
  `pdf, png, jpg, svg, docx, doc, xlsx, xls`.
- Upload each file via `POST /functions/v1/upload-submission-attachment`
  (multipart, including `session_token` + `submission_id` from form state).
- Show progress bar per file, remove-before-submit button per file.
- Persist uploaded attachments across save-draft cycles by re-querying
  `submission_attachments` on form load (filtered by submission_id).
- Studio-side delete via `POST /functions/v1/delete-submission-attachment`.
- Display retention notice: "Files we keep auto-delete 7 days after your
  onboarding is complete, or 90 days from upload — whichever is sooner."

### 2. Inbox composer file upload (studio + admin sides)

**Where:** the inbox composer used by both `portal.html` (studio) and the
admin Messages panel (in `admin/js/inbox.js` if it exists, or wired into
detail.js).

**Scope:**
- Attach button next to the message send button.
- Up to 5 files per message, same constraints as form upload.
- When the message is sent, the attachments are tied to the new message_id
  (the upload happens BEFORE message send, then on send we either pass
  attachment IDs to the send-message function or attach inline by
  message_id which the upload already supports).
- Inline display: attached files render as chips under the message body in
  the conversation thread (filename + size + download link).

Both phase-2 widgets call into the four edge functions already shipped —
no new backend work needed.

---

## Block 3 backlog — deferred audit findings

These don't block live cutover but should ship within a week. Full audit detail is in the session 2026-05-15 conversation history.

### Code-quality + architecture
- Extract ~120 lines of duplicated recipient-resolution from `create-quote` + `create-custom-invoice` into `_shared/recipient.ts`
- Extract `isoCountryForStripe` + `expectedCurrencyForCountry` to the same shared module
- AU GST rate cache (`_shared/stripe.ts:cachedAuGstRateId`) is misleading per-instance — either persist in `payment_settings` or fix the comment
- Quote handler row-locking race (concurrent webhook events both pass the downgrade guard) — switch to `.update(...).eq('status', expectedPrior)` conditional update
- `viewed_at` and `decline_reason` columns on `quotes` are never populated by any code path — remove or stub
- Status downgrade guard double-writes on `quote.finalized` after `create-quote` already set `sent` — minor noise
- No retry on 429/5xx from Stripe API in `stripe.ts`

### UX + design
- Currency lock affordance is invisible to touch users (relies on `[disabled]` + `title=` only) — visible lock glyph + helper text below the field
- Touch targets less than 44 by 44 on account.html Quote PDF link — WCAG 2.5.5 fail
- Hardcoded hex colours in 3 places (session-expired overlay, quote.js cancel link, account.html pills) — use CSS vars
- Em-dashes throughout new admin copy violate the StudioLAB design system no-em-dashes rule
- `btn-link:focus-visible` outline is `2px solid #fff` — works on admin header only, invisible elsewhere. Scope to `.adm-hdr .btn-link:focus-visible`
- Quote total scrolls off-screen on 1366×768 with 3+ line items — make summary `position: sticky`
- Studio Quotes section disappears silently when last quote cancelled — always render with empty state
- Quote success modal has no exit path / parity with Invoice success — add View in panel + Send another buttons
- Cancel confirm in `quote.js` uses native `confirm()` — switch to `AdminModal.confirm({ danger: true, ... })`
- Native `alert()` for failures in quote.js — switch to `AdminModal.alert`
- Inline `style="..."` attributes throughout the Quote modal markup — move into `admin.css`

### Brand + copy
- Email sign-off `StudioLAB Growth team` should be `StudioLAB team`
- Expiry warning email subject and H1 are identical — vary the H1 to `Your quote closes tomorrow`
- "Engagement" jargon in acceptance-mode hints — replace with "jobs"
- Cancel confirm clarity: `will see it as withdrawn` → `this withdraws it from the recipient and can't be undone`
- Currency-lock tooltips: `AU studio: quoted in AUD with 10% GST` is tighter than `Australian studio — AUD with GST is required.`
- Reminder email body: `creates an invoice with a pay link` → `accepting turns the quote into an invoice you can pay straight away`

### Functional + observability
- Quote-reminders cron doesn't notify admin on auto-cancel — add a daily digest email
- PDF download not logged in `activity_log`
- `parent_quote_id` cycle prevention — enforce ancestor rule
- Hard caps on line-item count and total amount (e.g., 50 lines, AUD $1M cap) to prevent fat-finger
- No metric/alert when `quote.canceled` arrives without a ledger row (Stripe dashboard manual cancels) — surface to admin inbox

---

## Repo conventions

- **Static surfaces** (admin/, account.html, etc.) auto-deploy via GitHub Pages on push to main. Cache-bust `?v=YYYYMMDDx` is required for CSS + JS changes.
- **Edge functions** require explicit `supabase functions deploy <name> --no-verify-jwt` per function.
- **Migrations**: the project has duplicate `004_*.sql` prefixes that break `supabase db push`. Apply new migrations manually via Supabase SQL Editor, then INSERT a row into `supabase_migrations.schema_migrations` to register.
- **Memory files** at `/Users/gary/.claude/projects/-Users-gary-Claude-Projects-Growth---Onboarding/memory/` hold load-bearing project rules. Read `MEMORY.md` at the start of every session.
- **Commit messages**: short imperative title, optional body, end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Auto mode**: when active, run git operations directly without asking. Always pause for SQL Editor steps — Claude can't run those.

---

## Suggested first message for next session

> Continuing the StudioLAB Growth onboarding project. Last session ended with audit fixes Block 1 + 2 pushed (commit 7e9bc4b). Before any new work I need to:
>
> 1. Redeploy the 6 edge functions listed in docs/SESSION-HANDOVER-2026-05-15.md
> 2. Manually verify AU GST attachment on a Stripe Quote (sandbox test, see Critical Follow-up A)
> 3. Run the full end-to-end test across all 12 plan/region/setup combinations (Critical Follow-up B)
>
> Once those pass, start Phase 2: Live cutover prep — Stripe Tax verification, email-gating audit, mode-flip script. Read docs/SESSION-HANDOVER-2026-05-15.md for the full state of play and the Block 3 backlog.
