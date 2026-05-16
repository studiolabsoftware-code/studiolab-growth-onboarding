-- Migration 031: relax activity_log.submission_id NOT NULL.
--
-- Smoke test 2026-05-17 surfaced that every external-recipient activity log
-- row (custom_invoice_sent, external_contact_created, invoice_marked_paid_manually,
-- project_created, deliverable_*) was silently failing to insert because
-- submission_id has a NOT NULL constraint and external flows legitimately
-- pass null. The call sites all wrap the insert in try/catch with
-- console.error, so the failure was invisible: lifecycle state moved
-- forward in the rows, but the audit trail was empty.
--
-- Fix: relax the constraint. External-flow activity rows are linked via
-- project_id or details->>'external_contact_id' instead. Existing
-- internal-flow rows (where submission_id is set) are unaffected.
--
-- This is non-destructive and idempotent.

alter table public.activity_log
  alter column submission_id drop not null;

-- Sanity comment for future readers.
comment on column public.activity_log.submission_id is
  'Nullable. External-recipient flows (invoices/quotes/projects for external_contacts) record activity with submission_id=null; the audit trail is linked via project_id or details->>external_contact_id instead.';

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('031_activity_log_submission_nullable')
ON CONFLICT DO NOTHING;
