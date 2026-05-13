# Phase 5: Stripe webhook handler — fresh-session handover

You're picking up the Stripe build on the StudioLAB Growth onboarding project. Phases 1–4 are live in test mode. The studio form takes payments via Stripe Checkout but our database never finds out, because the webhook isn't built yet. **Your job is phase 5.**

Working directory: `/Users/gary/Claude_Projects/Growth - Onboarding`. The project is a static HTML/JS site (hosted on GitHub Pages at `app.studiolabgrowth.com`) with Supabase Edge Functions for backend and Supabase Postgres for storage.

## Read first, in this order

1. `docs/stripe-integration-plan.md` — the source of truth for the whole Stripe build. Read it end to end. Pay particular attention to the **Webhook handling** table that lists every event we care about and the action it should trigger.
2. `supabase/migrations/008_payment_settings.sql` and `009_stripe_billing.sql` — the schema you'll be writing into. Don't memorise column names; just know they exist.
3. `supabase/functions/create-checkout-session/index.ts` — this is what *writes* the Stripe IDs and metadata your webhook will *read*. Confirm metadata keys (`submission_id`, `payment_mode`, `product_id`, `currency`) before you start parsing them.
4. `supabase/functions/save-draft/index.ts` — currently fires the studio confirmation email + admin notification + activity log on `finalize: true`. For the pay path, save-draft is now called with `finalize: false`, so the webhook is the new home for those side effects. Decide whether to extract a shared helper or duplicate the logic.
5. `supabase/functions/_shared/email-templates.ts` — `submissionConfirmation` and `adminNewSubmission` already exist. You'll need mode-aware variants of the studio confirmation (see "Side effects per mode" below).
6. `supabase/functions/_shared/cors.ts`, `supabase.ts`, `stripe.ts`, `caller.ts` — existing helpers. The signature verifier belongs in `stripe.ts`.

## Hard constraints

- The function must be deployed with `--no-verify-jwt`. Stripe doesn't present a JWT; if JWT is enforced the function rejects every event.
- **Signature verification** against `STRIPE_WEBHOOK_SECRET_TEST` and `STRIPE_WEBHOOK_SECRET_LIVE`. Header format: `t=<timestamp>,v1=<sig>[,v0=<sig>]`. Compute HMAC-SHA256 of `${timestamp}.${rawBody}` with the secret. Constant-time compare. Reject if `timestamp` is older than 5 minutes (replay protection). Try both secrets and accept whichever validates — that way one endpoint serves both test and live mode without forcing two deployments.
- **Idempotency** via `stripe_events` (event_id is PK). Insert first; on unique-violation (Postgres code `23505`) return 200 and skip processing. Insert *before* doing any work so we never double-process if our handler throws.
- Return **200** only on success. **500** on internal handler error so Stripe retries. **400** on signature failure. Never return 200 silently on errors.
- Read `raw text` of the request body (`await req.text()`) before any JSON parse — signature verification needs the exact bytes.

## Events to handle

### Must work in v1

- `checkout.session.completed` — most important. Branch by `mode` (`payment` vs `setup`) and `payment_intent_data.capture_method` (`automatic` vs `manual`).
- `checkout.session.expired` — set `payment_status='unpaid'` so the studio can retry.

### Should work in v1

- `payment_intent.succeeded` — money actually settled. For immediate this is near-simultaneous with checkout.session.completed; for hold it fires on capture; for save-card it fires when the future off-session charge succeeds. Update `paid_at`, `captured_at`, `payment_status='paid'`.
- `payment_intent.amount_capturable_updated` — hold mode auth ready. Set `authorization_expires_at = now + 7 days`.
- `payment_intent.payment_failed` — save-card off-session decline. `payment_status='charge_failed'`, store the failure reason.
- `payment_intent.canceled` — hold expired. `payment_status='auth_expired'`.
- `setup_intent.succeeded` — save-card mode succeeded. Store `payment_method_id`, `card_saved_at`.
- `setup_intent.setup_failed` — save-card mode failed; reset to `unpaid`.
- `invoice.finalized` / `invoice.payment_succeeded` — store `invoice_hosted_url` and `invoice_pdf_url`.
- `charge.refunded` — `payment_status='refunded'`. Do **not** auto-revert the workflow stage.

### Optional in v1

- `payment_method.detached` — saved card removed; flag the submission. Phase-11 territory.

Anything else: log and return 200.

## Side effects per mode (on `checkout.session.completed`)

The submission is currently `status='draft'`, `payment_status='pending'`. The webhook is what advances it. Different modes need different DB writes and different studio confirmation emails:

### Immediate

- `payment_status='paid'`, `status='submitted'`, `paid_at = now`, `captured_at = now`
- Store `stripe_payment_intent_id`, `amount_paid_cents`, `currency`, `tax_amount_cents` from the session/PI
- Email: *"You've been charged AUD $X (incl. GST). Your tax invoice is attached."*

### Hold (manual capture)

- `payment_status='authorised'`, `status='submitted'`, `authorization_expires_at = now + 7 days`
- Store `stripe_payment_intent_id`
- Email: *"Your card has been authorised for AUD $X (incl. GST). We'll only complete the charge once your setup begins. You won't see a settled charge on your statement until then."*

### Save-card (`mode=setup`)

- `payment_status='card_saved'`, `status='submitted'`, `card_saved_at = now`
- Store `payment_method_id` (from `setup_intent.payment_method`)
- Email: *"Your card has been saved securely. We'll charge AUD $X (incl. GST) when we begin your setup, and you'll receive a tax invoice at that time."*

For every mode: also send the admin notification email and insert an activity-log row with the appropriate action type from migration 009 (`payment_authorised`, `payment_captured`, `payment_card_saved`, etc.).

## Auth and data context (don't break these)

- Admin auth uses a custom JWT stored in `localStorage.sl-admin-jwt` and attached as a global Authorization header on the supabase-js client. `supabase-js`'s own session manager is bypassed deliberately. **Do not touch this** — it took most of a day to settle.
- Studio form auth uses `session_token_hash` on `submissions`. No Supabase Auth involvement.
- The studio form `js/form.js` has cache-busting `?v=YYYYMMDDx` on CSS and JS includes. If you change anything in `js/form.js` or `css/form.css`, bump the version in all six plan HTML files.

## Stripe and Supabase state

- AU GST is registered on the Stripe account. `automatic_tax: true` is already configured on checkout sessions.
- Currently in test mode (`payment_settings.stripe_mode='test'`).
- Test mode keys are set: `STRIPE_SECRET_KEY_TEST`, but **NOT** `STRIPE_WEBHOOK_SECRET_TEST`. Gary adds the webhook secret after he creates the endpoint in Stripe Dashboard.
- The webhook endpoint URL Stripe will hit: `https://hiaruvsdamggenhqdvtp.supabase.co/functions/v1/stripe-webhook`. It doesn't exist until you deploy.

## What to hand back to Gary when you're done

Three things:

1. **Migration / code change summary** — what you wrote, where, why.
2. **Deploy command:**
   ```
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
3. **Stripe Dashboard setup steps:**
   - Developers → Webhooks → Add endpoint
   - URL: `https://hiaruvsdamggenhqdvtp.supabase.co/functions/v1/stripe-webhook`
   - Events: enumerate exactly which to subscribe to (use the list above)
   - Copy the signing secret it shows, then run:
     ```
     supabase secrets set STRIPE_WEBHOOK_SECRET_TEST=whsec_...
     ```
4. **Smoke test plan** — fresh studio submission in incognito → final step → Pay with test card `4242 4242 4242 4242` → verify in Supabase that the submission row flips to `payment_status='paid'`, `status='submitted'`, and that the studio + admin emails arrive. Also verify a duplicate webhook delivery doesn't double-process (use Stripe Dashboard → Webhooks → "Send test webhook" to replay the same event ID).

## Conventions Gary has set during this build

- Australian English in copy.
- *"Typically X"* not *"within X"* for time-frame promises (no contractual deadlines).
- After CSS or JS changes, bump the `?v=YYYYMMDDx` cache version across all six plan HTML files.
- Commits get detailed multi-paragraph messages explaining the *why*.
- One commit per logical change, then push to main; GitHub Pages auto-rebuild.
- Migrations are paste-into-SQL-editor (no `supabase db push`); always give Gary the exact SQL.
- No em dashes in UI copy.

## After phase 5 lands

The next phase is the AI knowledge-base intake module — a post-payment expansion of the same onboarding form for Dominate AI studios. Gary is preparing a markdown spec for the KB fields and structure. **Do not start this work until he hands you the MD.** Your phase-5 commit should leave the codebase ready to plug it in — meaning `payment_status='paid'` actually persists, so the studio's session can survive across multiple sittings while they fill the KB.

## Files you'll likely create or change

- `supabase/functions/stripe-webhook/index.ts` — new function
- `supabase/functions/_shared/stripe.ts` — add `verifyStripeSignature` helper here
- `supabase/functions/_shared/email-templates.ts` — add mode-aware confirmation templates (or extend the existing one to take a `mode` argument)
- Possibly `supabase/functions/_shared/finalize.ts` — if you choose to extract the "submission finalised" side effects out of save-draft into a shared helper

No new migrations expected. The schema for everything you need already exists from migrations 008 and 009.

Good luck.
