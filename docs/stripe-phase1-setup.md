# Stripe build — phase 1 setup

This is the one-time plumbing to get the Settings page working. Once these
steps are done you can open `/admin` → Settings, click **Test connection**,
and see a green dot.

## 1. Run the database migration

In the Supabase SQL editor (or via `supabase db push`), run:

```
supabase/migrations/008_payment_settings.sql
```

This creates the singleton `payment_settings` row, RLS, and the updated_at
trigger. Nothing else in the app touches it yet — the migration is safe to run
on a live database.

## 2. Deploy the two new Edge Functions

```
supabase functions deploy stripe-test-connection
supabase functions deploy save-payment-settings
```

Both require the same env that the existing functions use
(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — already
set if `manage-admin-users` works.

## 3. Add the Stripe secrets to Supabase

These live in Supabase Edge Function secrets, not in the database, not in the
frontend, not in this repo. Add via the Supabase dashboard
(Edge Functions → Secrets) or the CLI:

```
supabase secrets set STRIPE_SECRET_KEY_TEST=sk_test_...
supabase secrets set STRIPE_WEBHOOK_SECRET_TEST=whsec_...
supabase secrets set STRIPE_SECRET_KEY_LIVE=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET_LIVE=whsec_...
```

Where to find them in the Stripe dashboard:

- **Secret keys** — Developers → API keys. Use the test toggle in the top
  right to switch between test and live before copying.
- **Webhook signing secrets** — Developers → Webhooks → (your endpoint) →
  Signing secret. You will not have these yet — they come from creating the
  endpoint in step 4.

You can start with just the test secret. The live secret can wait until
you are ready to flip the toggle.

## 4. Create the webhook endpoint in Stripe

The endpoint URL is shown on the Settings page (with a Copy button). It looks
like:

```
https://<your-supabase-project>.supabase.co/functions/v1/stripe-webhook
```

The `stripe-webhook` function itself does not exist yet — it ships in phase 5.
You can either skip this step until then, or create the endpoint now and grab
the signing secret so it is already in Supabase secrets when phase 5 lands.
The endpoint will return 404 until phase 5 deploys, which is fine.

When you create it, subscribe to these events (this matches the table in the
plan):

- `checkout.session.completed`
- `checkout.session.expired`
- `setup_intent.succeeded`
- `setup_intent.setup_failed`
- `payment_intent.amount_capturable_updated`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `invoice.finalized`
- `invoice.payment_succeeded`
- `charge.refunded`
- `payment_method.detached`

Create one endpoint per mode (test + live), copy each `whsec_…` into the
matching Supabase secret.

## 5. Confirm AU GST is on the Stripe account

The connection test will report `au_gst_registered: active` if Stripe Tax has
an active AU registration. If you see a different status (e.g. `scheduled`)
that is a warning rather than a hard error — Stripe lets you check out before
the registration becomes active, but tax will not apply automatically until
it does. Anything else means we need to fix the Tax settings before going
live.

## 6. Open the Settings page

`/admin` → sign in as the owner → Settings tab. The publishable key for the
current mode goes in the field on the page (publishable keys are safe to
store; this is the key the studio-facing form will use when phase 4 lands).
Press **Test connection** and you should see:

- Green dot, "Connected in test mode"
- Account ID present
- Secret key fingerprint shown (e.g. `sk_test_5••••4Xq2`)
- AU GST active (assuming registration is in)

If anything is red or amber, the message under the dot explains which env
secret or Stripe setting needs attention.
