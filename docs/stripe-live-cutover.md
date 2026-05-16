# Stripe live-mode cutover

Phase 5 of the Growth onboarding build is currently running in Stripe **test mode**. The webhook handler already supports both modes — it tries `STRIPE_WEBHOOK_SECRET_TEST` and `STRIPE_WEBHOOK_SECRET_LIVE` and accepts whichever validates — so the cutover is a configuration swap, not a code change.

Allow about 30 minutes including the smoke test.

---

## Before you start

You need:

- Logged-in access to the **Stripe dashboard** on the live account (top-left toggle set to "Viewing live data").
- Supabase project access with permission to set **Edge Function secrets**.
- Logged-in access to the **Growth admin** at `app.studiolabgrowth.com/admin/` as an owner-role user.
- Five minutes spare at the end to run one real card transaction with the smallest live product so the webhook is exercised end-to-end.

Nothing here is destructive — test mode keeps working alongside live mode, and the webhook code accepts either. You can flip back to test by reversing one setting in the admin panel.

---

## Step 1: Live API keys

In the Stripe dashboard (live mode):

- Go to **Developers → API keys**.
- Copy the **Publishable key** (`pk_live_…`).
- Reveal and copy the **Secret key** (`sk_live_…`). Do not paste this anywhere except Supabase.

The publishable key is safe in the database and the browser. The secret key only lives in Supabase Edge Function env vars.

---

## Step 2: Supabase secrets

In the Supabase dashboard for the Growth project, go to **Project Settings → Edge Functions → Manage secrets** (or use `supabase secrets set` from the CLI). Set:

- `STRIPE_SECRET_KEY_LIVE` = `sk_live_…` from step 1.
- Confirm `STRIPE_SECRET_KEY_TEST` is still present (do not delete; it is what keeps test-mode previews working).

`STRIPE_WEBHOOK_SECRET_LIVE` is set in step 4 below.

---

## Step 3: Publishable key in admin

In the Growth admin (`/admin/settings`):

- Find the **Stripe** card.
- In the **Live publishable key** field, paste `pk_live_…`.
- Save.

Leave `stripe_mode` set to **test** for the moment. Switching mode before the live webhook is configured would leave you taking real money with no settlement bookkeeping.

---

## Step 4: Live webhook endpoint in Stripe

In the Stripe dashboard (still in live mode):

- Go to **Developers → Webhooks → Add endpoint**.
- Endpoint URL: the same Supabase Edge Function URL the test webhook is pointed at — `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`.
- Description: `Growth onboarding — live`.
- Events to listen to: select the same set as the test endpoint. The minimum:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `payment_intent.succeeded`
  - `payment_intent.amount_capturable_updated`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `setup_intent.succeeded`
  - `setup_intent.setup_failed`
  - `invoice.finalized`
  - `invoice.payment_succeeded`
  - `charge.refunded`
- Create the endpoint.
- Click into the new endpoint, reveal the **signing secret** (`whsec_…`) and copy it.

Back in Supabase secrets, set:

- `STRIPE_WEBHOOK_SECRET_LIVE` = the `whsec_…` from above.

Wait for Edge Function secrets to propagate. They are usually live within a few seconds — there is no redeploy required.

---

## Step 5: Flip the mode

Once the live webhook is wired and its signing secret is in Supabase:

- Back in admin settings, flip `stripe_mode` to **live**.
- Save.

From this point, every new Checkout session is created against the live Stripe account. Test-mode sessions already in flight remain valid until they expire.

---

## Step 6: Smoke test

Run one real transaction end-to-end before you stop watching:

- Pick the cheapest product (or temporarily create a $1 live test product in Stripe).
- In an incognito window, walk through the Growth setup form for a Launch or Scale plan in live mode using a real card.
- Confirm:
  - The payment confirmation page resolves and shows the "you are all set" state.
  - In Stripe live dashboard, the payment shows up under **Payments**.
  - In the Growth admin, the submission shows `payment_status='paid'` and a populated `paid_at`.
  - You receive the live studio confirmation email and the admin notification email.
- Refund the test transaction from the Stripe dashboard once you have verified. Confirm the admin row flips to `payment_status='refunded'`.

If any of those checks fail, revert `stripe_mode` to **test** in admin and check the Supabase Edge Function logs for the `stripe-webhook` function before retrying.

---

## What does not need to change

- The webhook code itself. It tries both secrets on every event and routes to whichever validates. The live endpoint and test endpoint share one Edge Function URL.
- The `create-checkout-session` function. It already reads `stripe_mode` from `payment_settings` and uses the matching secret key.
- Front-end JS. The publishable key is fetched from `payment_settings` at runtime, so flipping the mode is enough.
- Customer-facing copy and pricing. Live products and prices are seeded independently — make sure the live Stripe account has the same products as test before flipping the mode, otherwise checkout will fail with a missing-price error.

---

## Rollback

If anything looks wrong after the cutover, flip `stripe_mode` back to **test** in admin. The webhook keeps both signing secrets, so test-mode events continue to be accepted; live-mode events keep landing too but stop being acted on by create-checkout-session.

Do not delete the live webhook endpoint or the live secret unless you are abandoning the cutover entirely. Stripe will retry failed deliveries for up to three days and removing the endpoint mid-flight can leave orphan payments without bookkeeping.

---

## Phase 6 — PM expansion live-mode checklist

Phase 6.1–6.5 added drafts, manual mark-paid, refunds, projects, deliverables, and the client-facing project page. Most of it shipped behind the same `payment_settings.stripe_mode` flag, so the original cutover above remains the headline switch. A few extra checks before flipping to live:

### Stripe Tax (AU GST)

Non-negotiable for AU revenue. Before flipping `stripe_mode = 'live'`:

1. **Live mode → Settings → Business** — confirm the registered office address is set (street, suburb, state, postcode, AU).
2. **Live mode → Tax** — confirm "Stripe Tax is active" with an **AU GST registration** matching your ABN and registration start date.
3. Issue a $1.00 test invoice to a real AU studio in live mode and confirm the PDF shows the GST line at 10%. Refund immediately.

`create-custom-invoice` skips `automatic_tax` in test mode (Stripe sandbox throws "must have a valid head office address" even when the dashboard reports complete). When `stripe_mode = 'live'`, automatic_tax + tax_id_collection both turn on — so if the live account isn't properly registered, the first live invoice ships with $0 GST. Verify before the first real send.

### Webhook events the live endpoint must receive

The Phase 6 webhook handler reacts to these in addition to the Phase 5 set:

- `invoice.payment_failed` — surfaces a `payment_failed` activity row so the admin team can see declines without checking Stripe.
- `quote.accepted` — spawns a project (status='briefing') for external recipients.
- `quote.canceled` — handled with the existing reason discriminator.

If you added these via "Select events" in the dashboard, confirm all four `invoice.*` and all four `quote.*` events are still ticked on the **live** endpoint. Default-event lists differ between test and live setup wizards.

### `PUBLIC_APP_ORIGIN` for client emails

The deliverable-submitted-for-review email includes a client magic-link URL pointing at `project.html`. Set the env var in Supabase (Live edge functions):

- `PUBLIC_APP_ORIGIN` = `https://app.studiolabgrowth.com`

Default is `https://app.studiolabgrowth.com` if the var is missing, so this is belt-and-braces.

### Smoke test the project + deliverable loop

End-to-end checks once live mode is on:

1. Issue a small external invoice ($1 + GST) with collection_method=send_invoice. Recipient gets the Stripe hosted invoice email.
2. Pay the invoice with a real card. Confirm:
   - Invoice row flips to **Paid** in admin.
   - A project auto-spawns (Projects nav → new row).
   - `invoice_paid` activity event shows on the project's Activity feed.
3. Open the new project, add a deliverable, click **Submit for review**. Confirm the recipient receives the "Ready for your review" email with the project URL.
4. Open the project URL in a private browser window (no admin session). Confirm the Deliverables tab loads the card with **Approve** and **Request revisions** buttons.
5. Click **Request revisions**, leave a note, send. Confirm:
   - Deliverable flips to **Revisions in progress** on the client page.
   - All admins get the "Revisions requested" email with the note embedded.
6. Refund the original invoice via Stripe (or the admin **Refund** kebab action). Confirm the invoice flips to **Refunded** and `invoice_refunded` lands on the activity feed.

If any step fails, flip `stripe_mode` back to **test** before triaging — the rollback is one toggle.
