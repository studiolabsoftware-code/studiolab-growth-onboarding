-- StudioLAB Growth Onboarding: initial schema
-- Run this once on a fresh Supabase project (SQL editor or `supabase db push`).

-- =============================================================================
-- Extensions
-- =============================================================================
create extension if not exists "pgcrypto";

-- =============================================================================
-- Tables
-- =============================================================================

-- Admins allowed to log into the dashboard via OTP.
create table if not exists public.admin_users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text not null,
  role        text not null default 'admin' check (role in ('owner', 'admin')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Studio onboarding submissions, one row per studio.
create table if not exists public.submissions (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  status             text not null default 'submitted'
                       check (status in ('submitted','in_review','changes_requested','setup_in_progress','complete')),
  assigned_to        text,

  -- Plan & setup
  plan               text not null check (plan in ('launch','scale','ai')),
  setup_type         text not null check (setup_type in ('dfy','guided')),

  -- Studio details
  studio_name        text not null,
  legal_name         text,
  country            text,
  timezone           text,
  studio_type        text,
  address            text,
  website            text,
  support_url        text,

  -- Primary contact
  first_name         text,
  last_name          text,
  contact_email      text not null,
  contact_phone      text,
  role               text,
  studiolab_email    text,

  -- Branding
  logo_url           text,
  primary_colour     text,
  secondary_colour   text,
  sign_off           text,
  email_tone         text,
  footer_notes       text,
  studio_description text,

  -- Email setup
  from_name          text,
  reply_email        text,
  custom_domain      boolean,
  email_domain       text,
  dns_access         text,

  -- SMS & social (Scale + AI only)
  sms_type           text,
  area_code          text,
  port_number        text,
  sms_tone           text,
  lead_sources       jsonb,

  -- Automations
  season_active      boolean,
  season_name        text,
  enrol_open_date    text,
  billing_start      text,
  season_end         text,
  active_workflows   jsonb,

  -- AI knowledge base (Dominate AI only)
  kb_profile         text,
  kb_classes         text,
  kb_pricing         text,
  kb_price_quoting   boolean,
  kb_policies        text,
  kb_events          text,
  kb_faqs            jsonb,
  kb_restricted      text,
  kb_tone            text,
  voice_hours        text,
  voice_escalate     text,

  -- Anything else
  extra_notes        text
);

create index if not exists submissions_created_at_idx on public.submissions (created_at desc);
create index if not exists submissions_status_idx     on public.submissions (status);
create index if not exists submissions_plan_idx       on public.submissions (plan);
create index if not exists submissions_assigned_idx   on public.submissions (assigned_to);

-- Change requests sent to studios by admins.
create table if not exists public.change_requests (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references public.submissions(id) on delete cascade,
  created_at        timestamptz not null default now(),
  created_by        text not null,
  fields            jsonb not null,
  message           text,
  -- token_hash stores sha256(raw_token). The raw token is emailed to the studio.
  token_hash        text not null unique,
  token_expires_at  timestamptz not null,
  status            text not null default 'sent'
                      check (status in ('sent','opened','completed','expired')),
  completed_at      timestamptz,
  updated_values    jsonb
);

create index if not exists change_requests_submission_idx on public.change_requests (submission_id);
create index if not exists change_requests_status_idx     on public.change_requests (status);
create index if not exists change_requests_token_idx      on public.change_requests (token_hash);

-- Activity timeline per submission.
create table if not exists public.activity_log (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  created_at     timestamptz not null default now(),
  action         text not null check (action in (
    'submitted','viewed','status_changed','change_request_sent',
    'change_request_completed','note_added','assigned','plan_changed'
  )),
  actor          text not null,
  details        jsonb
);

create index if not exists activity_log_submission_idx on public.activity_log (submission_id, created_at desc);

-- Internal admin notes per submission.
create table if not exists public.admin_notes (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  created_at     timestamptz not null default now(),
  created_by     text not null,
  content        text not null
);

create index if not exists admin_notes_submission_idx on public.admin_notes (submission_id, created_at desc);

-- =============================================================================
-- updated_at trigger
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists submissions_set_updated_at on public.submissions;
create trigger submissions_set_updated_at
  before update on public.submissions
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.admin_users     enable row level security;
alter table public.submissions     enable row level security;
alter table public.change_requests enable row level security;
alter table public.activity_log    enable row level security;
alter table public.admin_notes     enable row level security;

-- admin_users: only authenticated users (admins) can read the allowlist.
-- Login flow checks an email against this list using an Edge Function with the
-- service role key, so anon does NOT need read access here.
drop policy if exists admin_users_select on public.admin_users;
create policy admin_users_select on public.admin_users
  for select to authenticated using (true);

-- submissions: anon can insert (the public form). Authenticated admins read/update.
drop policy if exists submissions_insert_anon on public.submissions;
create policy submissions_insert_anon on public.submissions
  for insert to anon with check (true);

drop policy if exists submissions_select_admin on public.submissions;
create policy submissions_select_admin on public.submissions
  for select to authenticated using (true);

drop policy if exists submissions_update_admin on public.submissions;
create policy submissions_update_admin on public.submissions
  for update to authenticated using (true) with check (true);

-- The studio updates its own row via the magic-link update flow. The Edge
-- Function uses the service role key to do the write, so no anon update policy
-- is needed on this table.

-- change_requests: admin-only via authenticated. Token validation and completion
-- happen inside Edge Functions using the service role key.
drop policy if exists change_requests_all_admin on public.change_requests;
create policy change_requests_all_admin on public.change_requests
  for all to authenticated using (true) with check (true);

-- activity_log: admins read/write. Submission inserts log entries via trigger
-- or via the Edge Function on submission/completion.
drop policy if exists activity_log_all_admin on public.activity_log;
create policy activity_log_all_admin on public.activity_log
  for all to authenticated using (true) with check (true);

drop policy if exists activity_log_insert_anon on public.activity_log;
create policy activity_log_insert_anon on public.activity_log
  for insert to anon with check (action in ('submitted','change_request_completed'));

-- admin_notes: admins only.
drop policy if exists admin_notes_all_admin on public.admin_notes;
create policy admin_notes_all_admin on public.admin_notes
  for all to authenticated using (true) with check (true);

-- =============================================================================
-- Storage bucket for logos
-- =============================================================================
-- Bucket creation cannot run inside this migration in some Supabase setups.
-- If `storage.buckets` insert fails, create the bucket "logos" in the Supabase
-- dashboard (Storage > New bucket > public = false) before running the
-- policy statements below.
insert into storage.buckets (id, name, public)
values ('logos', 'logos', false)
on conflict (id) do nothing;

drop policy if exists logos_anon_upload on storage.objects;
create policy logos_anon_upload on storage.objects
  for insert to anon
  with check (bucket_id = 'logos');

drop policy if exists logos_admin_read on storage.objects;
create policy logos_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'logos');

-- =============================================================================
-- Seed: owner admin user
-- =============================================================================
insert into public.admin_users (email, name, role, is_active)
values ('studiolabsoftware@gmail.com', 'Gary', 'owner', true)
on conflict (email) do nothing;
