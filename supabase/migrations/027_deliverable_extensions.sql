-- =============================================================================
-- Phase 6.3b: deliverable extensions — comments, catalog templates, vocab
-- =============================================================================
-- Builds on migration 026 (deliverables + submission_attachments.deliverable_id).
-- This migration only adds; nothing here mutates existing data.
--
--   1. deliverable_comments — per-deliverable thread between admin and client
--   2. upgrade_products.deliverable_template + general_products.deliverable_template
--      — jsonb arrays of { title, description, visibility, default_due_offset_days }
--      so a catalog SKU can spawn deliverables on the spawned project automatically
--   3. submission_attachments.submission_id relaxed to nullable when scoped to a
--      deliverable on an external-contact project (no parent submission exists)
--   4. activity_log vocabulary: file-attach, comment-add, template materialisation
-- =============================================================================

-- 1. deliverable_comments ----------------------------------------------------
-- Author identity:
--   * admin: author_kind='admin', author_admin_id set, author_label = admin's email
--   * client: author_kind='client', author_admin_id null, author_label = the
--     recipient name we already render on the project page (free text snapshot)
-- We don't try to authenticate the client further — the comment is gated by the
-- project token at the edge function, and the recipient identity is fixed by
-- projects.submission_id or projects.external_contact_id.
create table if not exists public.deliverable_comments (
  id              uuid primary key default gen_random_uuid(),
  deliverable_id  uuid not null references public.deliverables(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  author_kind     text not null check (author_kind in ('admin','client')),
  author_admin_id uuid references public.admin_users(id) on delete set null,
  author_label    text not null,
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now()
);

comment on table public.deliverable_comments is
  'Per-deliverable thread between admin and client. Admin writes via '
  'manage-deliverable (JWT auth); client writes via portal-project '
  '(token auth). project_id is denormalised from deliverable for cheap '
  'list-by-project queries and to keep RLS predicates simple.';

create index if not exists deliverable_comments_deliverable_idx
  on public.deliverable_comments (deliverable_id, created_at);
create index if not exists deliverable_comments_project_idx
  on public.deliverable_comments (project_id, created_at desc);

alter table public.deliverable_comments enable row level security;

-- Admin reads via dashboard. All writes go through service-role edge functions,
-- so no insert/update/delete policies for authenticated.
drop policy if exists deliverable_comments_select_authenticated on public.deliverable_comments;
create policy deliverable_comments_select_authenticated on public.deliverable_comments
  for select to authenticated using (true);

-- 2. Catalog SKU deliverable templates ---------------------------------------
-- Each element: { title, description, visibility, default_due_offset_days }
--   title — required, 1..200 chars
--   description — optional, 0..4000 chars
--   visibility — 'client' | 'internal' (defaults to 'client' if omitted)
--   default_due_offset_days — integer days from project creation; null = no due
--
-- The schema isn't enforced at the DB level beyond it being a jsonb array —
-- create-custom-invoice / catalog editor validate shape on write, and the
-- materialiser in _shared/post-payment.ts is defensive on read.
alter table public.upgrade_products
  add column if not exists deliverable_template jsonb not null default '[]'::jsonb;
alter table public.general_products
  add column if not exists deliverable_template jsonb not null default '[]'::jsonb;

comment on column public.upgrade_products.deliverable_template is
  'jsonb array of deliverable specs materialised onto the spawned project '
  'when an invoice that picked this SKU is paid. Each element: '
  '{ title, description, visibility, default_due_offset_days }.';
comment on column public.general_products.deliverable_template is
  'jsonb array of deliverable specs materialised onto the spawned project '
  'when an invoice that picked this SKU is paid. Each element: '
  '{ title, description, visibility, default_due_offset_days }.';

-- 3. Relax submission_attachments.submission_id for external-contact deliverables
-- ---------------------------------------------------------------------------
-- The original 020 schema required submission_id NOT NULL because every
-- attachment was form- or message-scoped (both of which sit under a
-- submission). Phase 6.3b adds a third upload context: a deliverable on a
-- project that may belong to an external_contact (no submission). For that
-- case submission_id is null and deliverable_id carries the scope.
--
-- The CHECK ensures at least one of submission_id / message_id / deliverable_id
-- is set so we never end up with truly orphan rows.
alter table public.submission_attachments
  alter column submission_id drop not null;

alter table public.submission_attachments
  drop constraint if exists submission_attachments_scope_check;
alter table public.submission_attachments
  add constraint submission_attachments_scope_check
  check (
    submission_id is not null
    or deliverable_id is not null
  );

comment on column public.submission_attachments.submission_id is
  'Parent submission. Null only when the attachment is scoped to a '
  'deliverable on an external-contact project (no submission exists).';

-- 4. Activity_log vocabulary extensions --------------------------------------
-- Append the Phase 6.3b actions to the existing CHECK. Keep every prior action.
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
    -- NEW in 027: deliverable files + comments + template materialisation
    'deliverable_file_attached',
    'deliverable_file_removed',
    'deliverable_comment_added',
    'deliverable_template_materialised'
  ));
