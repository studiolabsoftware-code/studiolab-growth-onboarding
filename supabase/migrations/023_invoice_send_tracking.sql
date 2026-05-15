-- =============================================================================
-- Invoice send tracking
-- =============================================================================
-- Adds the timestamps the admin UI needs to surface "did this invoice
-- actually go out, and when was it last resent?".
--
--   email_sent_at   - set when Stripe's POST /v1/invoices/:id/send returns
--                     success. Captures the initial send.
--   last_resent_at  - set every time manage-invoice action=resend is called.
--   resend_count    - integer counter, ++ on each resend, useful when an
--                     admin wants to know "I've already hammered Stripe
--                     three times, the email is somewhere".
--   voided_at       - set when manage-invoice action=void succeeds. Status
--                     already moves to 'void' but a dedicated timestamp
--                     reads cleaner in the send-history display than the
--                     ambiguous updated_at.
--
-- Open-rate tracking (was-this-email-viewed) is NOT covered here. Stripe
-- doesn't expose an invoice-viewed event over webhooks and the in-product
-- invoice emails aren't routed through an ESP we can pixel-track. A
-- follow-up step will switch the customer-facing email through Postmark
-- (or similar) and write the open event back to this table.
-- =============================================================================

alter table public.invoices
  add column if not exists email_sent_at  timestamptz,
  add column if not exists last_resent_at timestamptz,
  add column if not exists resend_count   integer not null default 0,
  add column if not exists voided_at      timestamptz;

comment on column public.invoices.email_sent_at is
  'When Stripe accepted the /send call on the original issue. NULL means '
  'the invoice was either drafted-only or the send call failed.';
comment on column public.invoices.last_resent_at is
  'Most recent successful resend. NULL until a Resend action runs.';
comment on column public.invoices.resend_count is
  'Number of times the admin has hit Resend on this invoice.';
comment on column public.invoices.voided_at is
  'When the admin voided this invoice through manage-invoice. The status '
  'column also moves to ''void'' at the same time.';

create index if not exists invoices_email_sent_at_idx on public.invoices (email_sent_at desc nulls last);
