-- =============================================================================
-- Invoice drafts + manual-payment + refund metadata
-- =============================================================================
-- Phase 6.1 of the PM expansion. The invoices ledger already supports a
-- 'draft' status (migration 016) and amount_refunded_cents/refunded_at
-- columns, so this migration only adds:
--
--   * manual-payment metadata (mark-paid for cheque / bank transfer / cash)
--   * activity_log vocabulary for the new draft + mark-paid + refund actions
--
-- A separate code-level fix in manage-invoice corrects an existing
-- string-drift bug where the function wrote status='void' against a
-- constraint that only accepts 'voided'. The DB stays at 'voided'.
-- =============================================================================

-- 1. Manual-payment metadata --------------------------------------------------
-- Set when an admin marks an invoice paid out-of-band (cheque / EFT / cash).
-- manage-invoice also calls Stripe's POST /v1/invoices/:id/pay with
-- paid_out_of_band=true so the hosted invoice closes cleanly; the columns
-- below are our side of that record.
alter table public.invoices
  add column if not exists marked_paid_manually     boolean not null default false,
  add column if not exists manual_payment_method    text,
  add column if not exists manual_payment_reference text,
  add column if not exists manual_payment_date      date;

alter table public.invoices
  drop constraint if exists invoices_manual_payment_method_check;
alter table public.invoices
  add constraint invoices_manual_payment_method_check
  check (
    manual_payment_method is null
    or manual_payment_method in ('cheque','bank_transfer','cash','other')
  );

comment on column public.invoices.marked_paid_manually is
  'True when an admin marked this invoice paid out-of-band (cheque / EFT / '
  'cash). The Stripe invoice is closed via paid_out_of_band=true so it stops '
  'showing the "Pay now" hosted page.';
comment on column public.invoices.manual_payment_method is
  'cheque | bank_transfer | cash | other. Required when marked_paid_manually.';
comment on column public.invoices.manual_payment_reference is
  'Free-text reference the admin recorded (e.g. cheque number, EFT ref).';
comment on column public.invoices.manual_payment_date is
  'Calendar date (YYYY-MM-DD) the payment landed in our account. Distinct '
  'from paid_at (the timestamptz when the mark-paid action was recorded).';

-- 2. Activity_log vocabulary extensions --------------------------------------
-- Replace the action CHECK to add the Phase 6.1 lifecycle actions.
-- Preserves every action from migrations 001 → 023.
alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check
  check (action in (
    -- pre-billing
    'submitted','viewed','status_changed','change_request_sent',
    'change_request_completed','note_added','assigned','plan_changed',
    -- migration 009 billing
    'payment_started','payment_authorised','payment_captured',
    'payment_card_saved','payment_failed','payment_refunded',
    'payment_mode_changed','payment_pricing_changed','payment_session_expired',
    -- migration 016 invoices + quotes
    'invoice_issued','invoice_paid','invoice_voided',
    'invoice_refunded','invoice_resent',
    'custom_invoice_sent',
    'quote_drafted','quote_sent','quote_viewed','quote_accepted',
    'quote_declined','quote_expired','quote_revised','quote_reminded',
    'quote_cancelled',
    -- migration 017 external contacts
    'external_contact_created',
    -- NEW in 024: drafts + manual-paid + refund
    'invoice_drafted',
    'invoice_finalized_from_draft',
    'invoice_draft_deleted',
    'invoice_marked_paid_manually',
    'invoice_partially_refunded'
  ));

-- 3. Index for the drafts panel ----------------------------------------------
-- The admin drafts list filters by status='draft' ordered by created_at.
-- Drafts don't have issued_at yet, so reuse created_at.
create index if not exists invoices_drafts_idx
  on public.invoices (created_at desc)
  where status = 'draft';
