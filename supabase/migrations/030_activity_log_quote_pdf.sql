-- Migration 030: append quote_pdf_downloaded to the activity_log CHECK.
--
-- get-quote-pdf now writes an audit row whenever an admin or studio pulls
-- the PDF for a quote. Without this CHECK extension the insert would fail
-- and the download itself would still succeed (it's wrapped in best-effort
-- try/catch), so the symptom would be silent loss of audit data. Adding
-- the action keeps the audit log honest.

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
    'external_contact_paid',
    -- migration 020 attachments
    'attachment_uploaded','attachment_deleted','attachment_expired',
    -- migration 024 drafts + manual paid + refund
    'invoice_drafted',
    'invoice_finalized_from_draft',
    'invoice_draft_deleted',
    'invoice_marked_paid_manually',
    'invoice_partially_refunded',
    -- migration 025 projects
    'project_created',
    'project_linked_to_invoice',
    'project_status_changed',
    'project_completed',
    'project_cancelled',
    'project_owner_changed',
    'project_renamed',
    -- migration 026 deliverables
    'deliverable_created',
    'deliverable_updated',
    'deliverable_submitted_for_review',
    'deliverable_revisions_requested',
    'deliverable_approved',
    'deliverable_delivered',
    'deliverable_cancelled',
    -- migration 027 deliverable files + comments + template materialisation
    'deliverable_file_attached',
    'deliverable_file_removed',
    'deliverable_comment_added',
    'deliverable_template_materialised',
    -- NEW in 030: quote PDF download audit
    'quote_pdf_downloaded'
  ));

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('030_activity_log_quote_pdf')
ON CONFLICT DO NOTHING;
