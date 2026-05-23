-- 041_setup_tasks.sql
-- Phase 2 (Slice A) of the onboarding access & compliance plan.
-- See docs/onboarding-access-and-compliance-capture.md.
--
-- One row per (submission, surface) representing a single access-delegation
-- or compliance-capture tile in the post-payment Setup Checklist. Slice A
-- ships three surfaces: Google Business Profile, Google Analytics 4, and
-- Google Search Console. Future slices add gtm, google_ads, meta, tiktok,
-- sms_a2p, whatsapp — same table, different surface keys.
--
-- The studio sees these tiles on /account.html after payment. They submit
-- their access info per tile (URLs, IDs, "I don't have this yet" flag).
-- Admins receive an inbox notification on submission, do the actual setup
-- work, and mark the tile complete. The tile is non-blocking — the rest
-- of the portal stays usable while the checklist progresses in the
-- background.
--
-- Per-surface field requirements are encoded in the application layer,
-- not the schema, so we can iterate copy and capture rules without a
-- migration. The `data` jsonb keeps that flexibility.

create table if not exists public.setup_tasks (
  id                     uuid primary key default gen_random_uuid(),
  submission_id          uuid not null references public.submissions(id) on delete cascade,
  surface                text not null,
  status                 text not null default 'pending',
  data                   jsonb not null default '{}'::jsonb,
  studio_submitted_at    timestamptz,
  admin_started_at       timestamptz,
  completed_at           timestamptz,
  admin_notes            text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (submission_id, surface)
);

comment on table public.setup_tasks is
  'Post-payment Setup Checklist tiles. One row per (submission, surface) where surface is a third-party service we need access to (gbp, ga4, gsc, gtm, google_ads, meta, tiktok, sms_a2p, whatsapp). Status flow: pending -> submitted | no_account -> in_progress -> complete.';

comment on column public.setup_tasks.surface is
  'Third-party service key. Slice A: gbp | ga4 | gsc. Slice B: gtm | google_ads | meta | tiktok. Slice C: sms_a2p | whatsapp. Free text accepted but expected values map to per-surface UI templates.';

comment on column public.setup_tasks.status is
  'pending = studio has not opened the tile; submitted = studio shared access info and we need to action it; no_account = studio does not have this service yet (we will create on their behalf, DFY mode); in_progress = admin actioning; complete = done. Transitions are application-enforced, not constrained at the DB level.';

comment on column public.setup_tasks.data is
  'Surface-specific captured fields as a flat jsonb. Keys depend on surface. Examples — gbp: {maps_url, place_id, verification_status}; ga4: {measurement_id, property_id, account_name}; gsc: {property_url, property_type}. Validated client-side; admin trusts but verifies.';

comment on column public.setup_tasks.studio_submitted_at is
  'When the studio first saved a submission for this tile. Stays set even after admin actions, so we can audit response time.';

comment on column public.setup_tasks.admin_started_at is
  'When an admin moved the tile to in_progress. Used to surface "we are on it" UI to the studio.';

comment on column public.setup_tasks.completed_at is
  'When the admin marked the tile complete. Drives the "X of Y complete" counter and stops nudge emails.';

create index if not exists setup_tasks_submission_status_idx
  on public.setup_tasks (submission_id, status);

create index if not exists setup_tasks_status_open_idx
  on public.setup_tasks (status)
  where status in ('submitted', 'no_account', 'in_progress');

-- Auto-touch updated_at on row update. Mirrors the trigger pattern used by
-- service_requests / quotes / invoices so the row's "last modified"
-- timestamp is reliable for admin sorting.
create or replace function public.touch_setup_tasks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_setup_tasks_updated_at on public.setup_tasks;
create trigger trg_setup_tasks_updated_at
  before update on public.setup_tasks
  for each row execute function public.touch_setup_tasks_updated_at();

-- Row-level security: anon role cannot read; service_role (used by edge
-- functions) has full access. Studio-facing reads go through the
-- get-studio-account function which validates the session token first.
alter table public.setup_tasks enable row level security;

drop policy if exists setup_tasks_service_role_all on public.setup_tasks;
create policy setup_tasks_service_role_all
  on public.setup_tasks
  for all
  to service_role
  using (true)
  with check (true);
