-- =============================================================================
-- submissions.receipts_sent_at — one-shot guard for payment-receipt emails
-- =============================================================================
-- Background: Stripe events for a successful payment can arrive in any order
-- when the webhook is being retried (e.g. checkout.session.completed AFTER
-- payment_intent.succeeded if delivery is replayed). Both events flip
-- payment_status to 'paid', but only the checkout.session.completed handler
-- contains the email-sending block. When payment_intent.succeeded races
-- ahead, checkout.session.completed sees an already-paid submission and
-- bails on its idempotency check — and emails never fire.
--
-- This column lets a single shared helper claim the receipt-send atomically
-- via a conditional UPDATE: only the first caller succeeds in setting the
-- timestamp, all subsequent ones see it populated and skip. Whichever event
-- handler runs first wins the claim and sends the emails.
-- =============================================================================
alter table public.submissions
  add column if not exists receipts_sent_at timestamptz;

create index if not exists submissions_receipts_sent_idx
  on public.submissions (receipts_sent_at)
  where receipts_sent_at is not null;
