# Stripe integration plan — Growth onboarding checkout

**Status:** Plan, pre-build
**Author:** Gary + Claude
**Last updated:** 2026-05-12

## Goal

Add a checkout step at the end of the onboarding form so studios pay their one-off setup fee before any work begins. Payments, invoices, and billing history are stored on each studio's profile and visible in admin and the Sheets mirror. Ongoing software subscription stays in GHL — this only covers the setup fee.

## Core decisions (locked in)

- **When:** Checkout happens at the final step of the onboarding form. Studios can save as draft and pay later — nothing progresses until paid.
- **Charge model:** One-off setup fee per plan. Not recurring. Three plans: Launch, Scale, Dominate AI.
- **Setup type pricing:** Open question — does DFY vs Guided change the price within a plan? Assumption in this plan: yes, 6 SKUs total. Collapse to 3 if pricing is identical.
- **Stripe account:** Single account, multi-currency.
- **Currency:** Decided server-side from `region`. AU → AUD with 10% GST on top. Everyone else → USD, no tax.
- **Tax:** Stripe Tax with `automatic_tax: true`. AU GST registration added to the Stripe account so it applies automatically.
- **Checkout UI:** Stripe Checkout (hosted). No custom card fields.

## Payment timing modes

Three modes, controlled by a global default plus a per-submission override.

| Mode | What happens | When to use | Limit |
|---|---|---|---|
| **Immediate** | Card charged at checkout. Money settles. Invoice issued. | Default. Setup will start within days. | None |
| **Hold (manual capture)** | Card authorised, funds held but not captured. Capture fires when admin moves submission to a nominated stage, or manually. | Small backlog, capture within ~7 days. | 7-day auth window (Stripe extended auth up to 30 days requires account enablement). |
| **Save card** | Card saved via SetupIntent, no charge or hold. Charge fires later off-session. | Genuine backlog, weeks-long delay (>7 days). | Decline risk at capture time — card may have expired/cancelled. Mitigated by ageing alerts (see below). |

**All three modes ship in v1.**

### Mode controls

- **Global default** — admin settings dropdown with three options: "Capture immediately" / "Authorise and hold" / "Save card only". Affects only new checkout sessions; existing payments are unaffected.
- **Per-submission override** — every submission has its own `payment_mode` field, defaulting to the global at the moment of checkout but editable in admin. Used for one-off cases: a slow-responding studio, a custom payment arrangement, a known delay.

### Capture/charge triggers

- **Automatic:** when admin moves a submission to a nominated stage (default: `setup_in_progress`).
- **Manual:** "Capture payment" button on each submission for edge cases.

Both ship in v1. Auto is the normal path; manual is the override.

## Stripe object model

- **Products:** one Stripe Product per plan × setup type — created once via the admin product catalog (see below). Stored Stripe `product_id` is the link between our catalog and Stripe.
- **Prices:** **not stored as Stripe Price objects.** Source of truth is our Supabase `products` table (see Product Catalog section). At checkout we use Stripe Checkout `line_items[].price_data` to pass the amount, currency, and product reference inline. This sidesteps Stripe's immutable-Price problem (a price change would otherwise require creating a new Price and archiving the old every time) and lets us apply per-submission overrides cleanly.
- **Customers:** created on first checkout attempt, keyed on contact email. Reused on retries so studios that abandon and return don't get duplicates. Stored on submission as `stripe_customer_id`.
- **Checkout Session:**
  - Immediate mode: `mode: payment`, `automatic_tax: { enabled: true }`, `payment_intent_data.capture_method: 'automatic'`.
  - Hold mode: `mode: payment`, `automatic_tax: { enabled: true }`, `payment_intent_data.capture_method: 'manual'`.
  - Save-card mode: `mode: setup` (SetupIntent only — no PaymentIntent at this stage). Price total, tax, and currency are shown on our own confirmation summary because the Stripe Checkout setup-mode page does not display the amount. The actual charge happens later via an off-session PaymentIntent that we create when the capture trigger fires.
- **PaymentIntent:** created by the session in immediate/hold modes. In save-card mode, created server-side later when the charge fires, using the saved `payment_method` and `customer`, `off_session: true`, `confirm: true`, with `automatic_tax` enabled so GST is applied correctly at charge time.
- **Invoice:** hosted invoice URL + PDF URL persisted on the submission. In save-card mode the invoice is created at charge time, not at card-save time.

## Product catalog and pricing management

A first-class admin page that controls every price flowing through checkout. No code changes required for price rises, sales, or one-off discounts.

### Source-of-truth model

**Supabase holds the catalog. Stripe holds the Products (for reporting) but not the Prices.** Checkout Sessions are built with inline `price_data` that pulls the active amount from our `products` table at session-creation time. This means:

- Changing a price in admin takes effect on the **very next checkout session**. No Stripe API dance, no archive/create cycle, no code deploy.
- Existing pending/authorised/saved-card submissions keep the price they locked in at checkout creation (we snapshot it onto the submission — see below). A price change today doesn't retroactively re-charge yesterday's customer.
- Stripe-side reporting still works because every Checkout Session references a `stripe_product_id`. Revenue by product is intact in the Stripe dashboard.

### Database tables

**`products`** — one row per plan × setup type × currency. Six rows in v1 (Launch-DFY-AUD, Launch-DFY-USD, Launch-Guided-AUD, Launch-Guided-USD, …) or three pairs if pricing collapses.

- `id` (uuid)
- `plan` — `'launch' | 'scale' | 'ai'`
- `setup_type` — `'dfy' | 'guided'`
- `currency` — `'AUD' | 'USD'`
- `stripe_product_id` — the Stripe Product reference (created once via admin)
- `name` — display name shown on Checkout
- `description` — display description
- `amount_cents` — ex-tax (GST applied on top by Stripe Tax for AUD)
- `active` — boolean; inactive products can't be checked out but historical submissions still resolve
- `effective_from` (timestamptz)
- `updated_at`, `updated_by` (admin user)

**`product_price_history`** — every price change appended, never updated. Audit trail.

- `id`, `product_id`, `amount_cents`, `changed_at`, `changed_by`, `reason` (free text), `previous_amount_cents`.

**`discount_codes`** — reusable promos.

- `id`, `code` (unique, case-insensitive)
- `kind` — `'percentage' | 'fixed_amount'`
- `value` — percent (1-100) or cents off
- `applies_to` — `'all' | array of product_ids`
- `currency` — required when `kind = fixed_amount`; null for percentage
- `valid_from`, `valid_until` (nullable)
- `max_redemptions` (nullable), `redemption_count`
- `active`, `created_at`, `created_by`

**`submission_pricing`** (or columns on `submissions`) — the price actually charged on each submission, snapshotted at checkout-session creation time.

- `product_id` (the catalog row in effect at the time)
- `list_amount_cents` (the active product amount when this session was created)
- `discount_code_id` (nullable)
- `discount_amount_cents` (nullable — the value at the time, frozen)
- `override_amount_cents` (nullable — admin-set per-submission price, takes precedence over list and discount)
- `override_reason` (nullable — free text required if override set)
- `final_amount_cents` (the actual amount that hits Stripe — resolved at checkout)
- `currency`

The snapshot pattern means changing list prices, discount codes, or anything else **never disturbs an existing submission**. The amount they were quoted is the amount they're charged. Compliance, customer trust, and audit cleanliness all depend on this.

### Admin product catalog page

A new admin route `/admin/products` (or similar) with:

- **Plan × setup type matrix** — six rows showing AUD and USD prices side by side, current list price, last changed date, last changed by.
- **Edit price** — inline editor with required reason field. Writes to `products.amount_cents`, appends to `product_price_history`. Takes effect immediately for new checkouts.
- **Toggle active** — disable a plan from being checked out without deleting historical data.
- **Sync product to Stripe** — button that creates/updates the Stripe Product (name, description) if missing. First-time setup convenience.

A separate **Discount codes** tab on the same page:

- Create, edit, expire, and disable codes.
- Per-code redemption count and usage report.
- Generate a Stripe-style code (`SUMMER25`) or accept a custom string.

### Per-submission price overrides

On any submission detail view in admin, a "Pricing" block:

- Shows the list price for that submission's plan + setup + region currency.
- **Apply discount code** dropdown (lists active codes; readable preview of the resulting amount).
- **Custom price override** field with reason (required). Locks the final amount regardless of list price or discount.
- **Final amount preview** showing the exact total the studio will be charged including GST for AU.
- All three (list/discount/override) are saved to `submission_pricing` and used by the next Checkout Session this submission creates. Already-paid submissions show the historical price as read-only.

### Studio-facing discount entry

The final step of the onboarding form gets an optional **"Have a discount code?"** field. Validated against `discount_codes` at session-creation time (not client-side — server enforces validity, expiry, and per-code redemption cap). Invalid codes show an error but don't block paying at the list price.

### Where Stripe Tax fits with inline prices

`automatic_tax: true` works with `price_data` line items as long as `tax_behavior: 'exclusive'` is set on the line item and the Stripe Product is configured with a tax code. The 10% GST for AU keeps applying automatically; nothing about the catalog change breaks tax handling.

## Checkout flow

1. Studio reaches the final step. Sees a summary of their configuration and a price block: subtotal, GST (AU only), total in their currency.
2. Two buttons: **Pay & submit** or **Save draft, pay later**.
3. **Pay & submit** calls Supabase Edge Function `create-checkout-session` with the submission ID. The function:
   - Resolves the active `payment_mode` (per-submission override → global default).
   - Resolves the **final price**: look up the active `products` row matching plan + setup type + region currency, apply any submission-level discount code and/or override, snapshot the result into `submission_pricing`.
   - Looks up or creates the Stripe Customer for that email.
   - Builds the Checkout Session with `line_items[].price_data` (inline) referencing the Stripe `product_id` and using the snapshotted amount + currency, plus `automatic_tax`, `capture_method`, success and cancel URLs.
   - Writes `stripe_customer_id`, `stripe_checkout_session_id`, `payment_status: 'pending'`, and the resolved `payment_mode` to the submission.
   - Returns the redirect URL.
4. Studio is redirected to Stripe Checkout.
5. Success → confirmation page on our domain. Cancel → back to the final step with their data intact.
6. The confirmation page **does not trust the URL**. It waits for the webhook to mark the submission paid before showing success — Stripe's success redirect can fire before settlement.
7. **Save draft, pay later** writes the submission with `status: draft`, `payment_status: 'unpaid'`. Triggers the pay-later reminder email sequence. No stage advance. No Sheets sync as a real submission.

## Webhook handling

One Edge Function `stripe-webhook`. Signature-verified. Idempotent via a `stripe_events` table keyed on event ID.

| Event | Action |
|---|---|
| `checkout.session.completed` | Immediate: mark `paid`, advance `draft → submitted`, store payment + invoice IDs and amounts, fire downstream sync + handoff doc. Hold: mark `authorised`, store auth details and expiry, advance `draft → submitted`. Save-card: mark `card_saved`, store `payment_method_id`, advance `draft → submitted`. |
| `setup_intent.succeeded` | Save-card mode confirmation. Stores `payment_method_id` and `card_saved_at`. |
| `setup_intent.setup_failed` | Save-card mode failure. Sets status back to `unpaid`, surfaces error to admin. |
| `payment_intent.amount_capturable_updated` | Hold mode: auth ready to capture. Updates `authorization_expires_at`. |
| `payment_intent.succeeded` | Capture/charge settled. Sets `captured_at` and `paid_at`. Applies to both hold (manual capture) and save-card (off-session charge). |
| `payment_intent.payment_failed` | Save-card off-session charge declined. Sets status to `charge_failed`, alerts admin, retains saved card for retry. |
| `payment_intent.canceled` | Hold expired or was cancelled. Sets status to `auth_expired`, alerts admin. |
| `invoice.finalized` / `invoice.payment_succeeded` | Store `invoice_hosted_url` and `invoice_pdf_url`. Stripe emails the receipt; no need to duplicate. |
| `charge.refunded` | Set `payment_status: 'refunded'`. Flag in admin. Stage is **not** auto-reverted. |
| `checkout.session.expired` | Drop back to `unpaid` so the studio can retry. |
| `payment_method.detached` | Save-card mode: if a studio's saved card is removed (rare — admin action or expiry), flag the submission so we know to request a new one before the charge trigger fires. |

## Database changes

Add to `submissions`:

- `payment_status` — `'unpaid' | 'pending' | 'authorised' | 'card_saved' | 'paid' | 'auth_expired' | 'charge_failed' | 'refunded'`
- `payment_mode` — `'immediate' | 'hold' | 'save_card'`
- `stripe_customer_id`
- `stripe_checkout_session_id`
- `stripe_payment_intent_id`
- `stripe_invoice_id`
- `invoice_hosted_url`
- `invoice_pdf_url`
- `amount_paid_cents`
- `currency`
- `tax_amount_cents`
- `authorization_expires_at` (hold mode)
- `captured_at` (separate from `paid_at` for hold mode)
- `payment_method_id` (save-card mode — the saved card to charge later)
- `card_saved_at` (save-card mode)
- `charge_scheduled_for` (save-card mode — optional admin-set date to fire the charge automatically)
- `last_charge_attempt_at` and `charge_failure_reason` (save-card mode — for retry tracking)

New table `stripe_events` — `event_id` PK, `type`, `received_at`, `payload` — for webhook idempotency.

New table or settings row `payment_settings` — `default_payment_mode`, `auto_capture_stage`, updated by admin.

## Admin dashboard additions

- **Payment status pill** on each submission card (Unpaid / Pending / Authorised / Card Saved / Paid / Auth Expired / Charge Failed / Refunded), with amount and currency.
- **Detail view billing block:** invoice PDF link, hosted invoice link, transaction ID, paid date, captured date, payment mode, card last-four.
- **Per-submission payment mode override** — dropdown on the detail view, changes the mode used for the *next* checkout session created for this submission. Doesn't affect already-completed payments.
- **Send payment link action** — generates a fresh Checkout Session for an unpaid or auth-expired submission and emails the resume URL. Useful when a draft has gone cold.
- **Capture payment button** — manual capture for hold-mode submissions.
- **Charge saved card button** — manual trigger for save-card mode. Creates the off-session PaymentIntent, applies GST, generates the invoice. Confirmation modal shows the exact amount and currency before charging.
- **Schedule charge** — for save-card mode, optional date picker to fire the charge automatically. Useful when you know setup will start on a specific day.
- **Saved cards view** — list of `card_saved` submissions sorted by oldest first, with card age (so you can spot ones approaching the ~6 month off-session reliability cliff). Visual alert past 90 days.
- **Retry failed charge button** — for `charge_failed` submissions, retry the off-session charge. Also offers "Send new payment link" as the fallback when the saved card is dead.
- **Refund action** — calls Stripe with a reason field. Admin-gated.
- **Pending authorisations view** — separate list of hold-mode submissions sorted by soonest auth expiry. Visual alert when within 24h of the 7-day window without capture.
- **Settings page** — global default payment mode toggle, auto-capture stage selector.

## Studio-facing communication

Three different post-checkout messages depending on mode. Without these you get support tickets about pending charges. Copy goes in the confirmation page and the receipt email:

- **Immediate:** "You've been charged AUD $X (incl. GST). Invoice attached."
- **Hold:** "Your card has been authorised for AUD $X. We'll only complete the charge once your setup begins."
- **Save card:** "Your card has been saved securely with our payment provider. We'll charge AUD $X (incl. GST) when we begin your setup, and you'll receive a tax invoice at that time. You won't see a pending charge on your statement until then."

Save-card mode also needs an **explicit consent checkbox** on the final step before saving the card: *"I authorise StudioLAB to charge my saved card AUD $X (incl. GST) when setup work begins."* Stripe and AU consumer law both expect this for stored-credential off-session charges. The consent text and timestamp are saved on the submission.

## Studio "card file" (profile billing history)

On each studio's detail tab in admin, and inside the handoff `.docx` you're already generating, add a Billing section:

- Invoice number
- Amount, currency, GST
- Payment mode used
- Authorised date (if applicable)
- Paid/captured date
- Card last-four
- Link to hosted invoice + PDF

## Sheets mirror updates

Add to the Dashboard and stage tabs:

- Payment status column
- Amount + currency column
- Paid date column
- Invoice URL column (HYPERLINK to hosted invoice)

Add to per-studio detail tabs: a Billing section mirroring the admin block above.

## Pay-later reminder cadence

For drafts with `payment_status: 'unpaid'`:

- Day +1: gentle nudge with resume link
- Day +3: second nudge
- Day +7: final nudge
- Day +14: auto-archive to "Cold drafts" view (not deleted)

Same resume link in each email — a fresh Checkout Session generated on click so prices and tax are current.

## Refund handling

`charge.refunded` webhook sets status to `refunded`. Admin sees the flag but the workflow stage is **not** auto-reverted — by the time you're refunding, work may already be done and the right next action is a human decision, not an automatic stage rollback.

## Delivery phases

Each phase is independently testable.

1. **Stripe setup** — Stripe Products (created via admin product catalog page; no Prices), Stripe Tax with AU GST registration, webhook endpoint, test mode keys.
2. **DB migration** — new columns on `submissions`, new tables: `stripe_events`, `payment_settings`, `products`, `product_price_history`, `discount_codes`, `submission_pricing`.
3. **Admin product catalog page** — products matrix with edit/activate, price history view, discount codes tab, "Sync to Stripe" button. Built early so all subsequent test data uses real catalog values.
4. **`create-checkout-session` Edge Function** + final-step UI with price summary, discount code field, and Pay/Save-draft buttons.
5. **`stripe-webhook` Edge Function** — handles all event types with idempotency.
6. **Confirmation page** — waits for webhook before showing success; handles cancel return.
7. **Admin dashboard payment additions** — status pill, billing block, mode override, send payment link, capture button, refund, pending-auths view, per-submission pricing block (discount/override), settings page.
8. **Studio communications** — three confirmation/receipt variants by mode.
9. **Pay-later reminder emails** + cold-draft archive.
10. **Sheets sync columns** for finance visibility.
11. **Save-card off-session charge logic** — server-side function that takes a `card_saved` submission, creates an off-session PaymentIntent with automatic tax, handles 3DS challenge fallback (rare but possible — if Stripe returns `requires_action`, email the studio a confirmation link to complete authentication), records the result.
12. **Scheduled-charge cron** — daily Edge Function run that finds save-card submissions with `charge_scheduled_for <= today` and fires the charge.
13. **End-to-end test pass** — covers all three modes: AU + US for each of immediate / hold / save-card, plus auto-capture on stage move, hold auth expiry, save-card off-session success, save-card off-session decline + retry, save-card 3DS challenge, save-card scheduled charge, per-submission override changes mode for next session only, draft + resume, refund, Apple Pay, duplicate-submit race.

## Open items to confirm before build

- **DFY vs Guided pricing** — 6 SKUs or 3?
- **Auto-capture stage** — default to `setup_in_progress`, or different?
- **Stripe extended authorization** — worth enabling on the account now for the 30-day hold window, or stay on the 7-day default?
- **Refund window/policy** — any business rules on when refunds are allowed?
- **Save-card maximum age** — at what point do we stop trusting a saved card and force a fresh payment link? Default proposal: warn at 90 days, force re-auth at 180 days. Confirm.
- **Save-card scheduled charge** — needed in v1, or just manual "Charge now" button? Default proposal: include in v1 since it's small once the off-session charge logic exists.
- **Discount code visibility** — should the studio-facing form expose the "Have a discount code?" field always, or only when a campaign is active (controlled by a setting)? Default proposal: always visible, validated server-side.
- **Per-submission override authority** — any admin role gating, or all admins can override? Default proposal: all admins, with reason required and full audit trail in `submission_pricing` + change log.
