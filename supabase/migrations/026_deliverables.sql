-- =============================================================================
-- Deliverables: per-project units of work with approve / request-revisions
-- =============================================================================
-- Phase 6.3 of the PM expansion. A deliverable is one discrete piece of work
-- the team ships inside a project. Each carries its own state machine:
--
--   pending → in_progress → submitted_for_review
--                              ↓ approved → delivered
--                              ↓ revisions_requested → in_progress (loop)
--   cancelled reachable from any non-terminal state.
--
-- Phase 6.3 ships the table + status moves only. Phase 6.3b (later) will
-- add: deliverable_events (per-deliverable timeline), catalog SKU template
-- materialisation, file attachments scoped to a deliverable, comments.
-- =============================================================================

create table if not exists public.deliverables (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  title               text not null,
  description         text not null default '',
  status              text not null default 'in_progress'
    check (status in ('pending','in_progress','submitted_for_review','revisions_requested','approved','delivered','cancelled')),
  visibility          text not null default 'client'
    check (visibility in ('client','internal')),
  assigned_admin_id   uuid references public.admin_users(id) on delete set null,
  due_date            date,
  order_index         integer not null default 100,
  submitted_at        timestamptz,
  approved_at         timestamptz,
  delivered_at        timestamptz,
  cancelled_at        timestamptz,
  -- Last revisions-requested note from the client. Cleared when the
  -- deliverable next moves to submitted_for_review so the admin always sees
  -- the most recent feedback the client gave.
  revisions_notes     text,
  -- Link to a catalog SKU template materialisation, optional. Phase 6.3b
  -- will use this to mark "this deliverable was spawned from upgrade SKU X".
  source_sku          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.admin_users(id)
);

comment on table public.deliverables is
  'Per-project work units. Status moves through the approve / request-'
  'revisions loop driven by both admin (submit_for_review, mark_approved) '
  'and client (approve, request_revisions) actions.';

create index if not exists deliverables_project_idx
  on public.deliverables (project_id, order_index, created_at);
create index if not exists deliverables_status_idx
  on public.deliverables (status, created_at desc);
create index if not exists deliverables_assigned_idx
  on public.deliverables (assigned_admin_id)
  where assigned_admin_id is not null;
create index if not exists deliverables_client_visible_idx
  on public.deliverables (project_id, order_index)
  where visibility = 'client';

drop trigger if exists deliverables_set_updated_at on public.deliverables;
create trigger deliverables_set_updated_at
  before update on public.deliverables
  for each row execute function public.set_updated_at();

alter table public.deliverables enable row level security;

drop policy if exists deliverables_select_authenticated on public.deliverables;
create policy deliverables_select_authenticated on public.deliverables
  for select to authenticated using (true);

drop policy if exists deliverables_modify_owner_admin on public.deliverables;
create policy deliverables_modify_owner_admin on public.deliverables
  for all to authenticated
  using (exists (select 1 from public.admin_users au where au.id = auth.uid() and au.role in ('owner','admin') and au.is_active))
  with check (exists (select 1 from public.admin_users au where au.id = auth.uid() and au.role in ('owner','admin') and au.is_active));

-- Activity_log: extend action CHECK with deliverable lifecycle events. Keep
-- the unified timeline (single activity_log) — deliverable-only events that
-- need higher-volume separation will move to deliverable_events in 6.3b.
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
    -- NEW in 026: deliverables
    'deliverable_created',
    'deliverable_updated',
    'deliverable_submitted_for_review',
    'deliverable_revisions_requested',
    'deliverable_approved',
    'deliverable_delivered',
    'deliverable_cancelled'
  ));

-- Attach deliverable_id to submission_attachments so files can be scoped to
-- a deliverable (Phase 6.3b). Nullable; no immediate impact on existing rows.
alter table public.submission_attachments
  add column if not exists deliverable_id uuid references public.deliverables(id) on delete set null;

create index if not exists submission_attachments_deliverable_idx
  on public.submission_attachments (deliverable_id) where deliverable_id is not null;
