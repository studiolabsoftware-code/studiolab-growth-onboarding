-- =============================================================================
-- Projects: the PM canonical surface
-- =============================================================================
-- Phase 6.2a of the PM expansion. Adds the projects table + project_id FKs
-- on the four surfaces that need to roll up under a project (invoices,
-- quotes, conversations, submission_attachments). Activity log gets a
-- project_id column so project events live in the same unified timeline
-- as everything else.
--
-- Per project_pm_architecture: projects are the canonical place where the
-- team tracks delivered work. Invoices fund the project; the work itself
-- lives here. Studio onboardings STAY in submissions; projects sit
-- alongside, linked by submission_id when relevant.
--
-- Recipient model: exactly one of (submission_id, external_contact_id) is
-- set, enforced via XOR check. External recipients use the new
-- project-level token for magic-link access (mirrors conversations.studio_token).
--
-- Spawn policy: external invoices always spawn a project on paid; studio
-- invoices opt-in via invoices.spawn_project_on_paid (defaults false).
-- Upgrade-SKU invoices never spawn — they're state changes on the
-- existing studio, not new engagements.
-- =============================================================================

-- 1. projects table ----------------------------------------------------------
create table if not exists public.projects (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  project_type          text not null default 'service'
    check (project_type in ('service','consulting','website_build','custom','other')),
  status                text not null default 'in_progress'
    check (status in ('briefing','in_progress','review','complete','cancelled','on_hold')),
  -- Recipient. XOR enforces exactly one of the two is set.
  submission_id         uuid references public.submissions(id) on delete set null,
  external_contact_id   uuid references public.external_contacts(id) on delete set null,
  -- Project-level magic-link token. Mirror of conversations.studio_token.
  -- Phase 6.2 will land verifyProjectToken in _shared/projects.ts; we mint
  -- the token here so client-facing project pages can authenticate by URL
  -- once that endpoint exists.
  token                 text unique,
  token_expires_at      timestamptz,
  -- Currency lock at spawn time. Future invoices/quotes linked to this
  -- project must match this currency (enforced in app code, not DB —
  -- prevents mixed-currency engagement messes).
  currency              text check (currency is null or currency in ('AUD','USD')),
  owner_admin_id        uuid references public.admin_users(id),
  due_at                timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  created_by            uuid references public.admin_users(id),
  constraint projects_recipient_xor check (
    (submission_id is not null and external_contact_id is null)
    or (submission_id is null and external_contact_id is not null)
  )
);

comment on table public.projects is
  'Engagement-level work record. Invoices fund the project; deliverables '
  '(migration 026, future) capture what gets shipped. Recipient is either '
  'a studio (submission_id) or an external contact (external_contact_id), '
  'never both.';

create index if not exists projects_submission_idx
  on public.projects (submission_id) where submission_id is not null;
create index if not exists projects_external_contact_idx
  on public.projects (external_contact_id) where external_contact_id is not null;
create index if not exists projects_status_idx on public.projects (status, created_at desc);
create index if not exists projects_owner_idx
  on public.projects (owner_admin_id) where owner_admin_id is not null;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

drop policy if exists projects_select_authenticated on public.projects;
create policy projects_select_authenticated on public.projects
  for select to authenticated using (true);

drop policy if exists projects_modify_owner_admin on public.projects;
create policy projects_modify_owner_admin on public.projects
  for all to authenticated
  using (exists (select 1 from public.admin_users au where au.id = auth.uid() and au.role in ('owner','admin') and au.is_active))
  with check (exists (select 1 from public.admin_users au where au.id = auth.uid() and au.role in ('owner','admin') and au.is_active));

-- 2. project_id FKs on existing surfaces -------------------------------------
-- All nullable; projects are opt-in for now (Phase 6.2 onwards starts auto-
-- spawning on invoice.paid for external recipients).
alter table public.invoices
  add column if not exists project_id            uuid references public.projects(id) on delete set null,
  add column if not exists spawn_project_on_paid boolean not null default false;

comment on column public.invoices.spawn_project_on_paid is
  'When true, paying this invoice auto-spawns a project. External-recipient '
  'invoices always spawn regardless of this flag (set true at create time '
  'for clarity). Studio invoices respect the flag — upgrade SKUs leave it '
  'false; service/consulting picks set it true via the admin modal.';

alter table public.quotes
  add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table public.conversations
  add column if not exists project_id uuid references public.projects(id) on delete set null;

alter table public.submission_attachments
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists invoices_project_idx
  on public.invoices (project_id) where project_id is not null;
create index if not exists quotes_project_idx
  on public.quotes (project_id) where project_id is not null;
create index if not exists conversations_project_idx
  on public.conversations (project_id) where project_id is not null;
create index if not exists submission_attachments_project_idx
  on public.submission_attachments (project_id) where project_id is not null;

-- 3. activity_log: project_id column + new action types ----------------------
-- Single unified timeline rather than a separate project_events table for
-- non-deliverable events. Per architectural concern #5 in the Phase 6.1
-- scoping response: keep one timeline, fork for deliverables only (Phase 6.3).
alter table public.activity_log
  add column if not exists project_id uuid references public.projects(id) on delete set null;

create index if not exists activity_log_project_idx
  on public.activity_log (project_id, created_at desc) where project_id is not null;

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
    -- NEW in 025: projects
    'project_created',
    'project_linked_to_invoice',
    'project_status_changed',
    'project_completed',
    'project_cancelled',
    'project_owner_changed',
    'project_renamed'
  ));
