-- StudioLAB Growth Onboarding: drafts + email-OTP verification
-- Run after 001_initial_schema.sql.

-- =============================================================================
-- submissions: extend for draft mode + session ownership
-- =============================================================================

-- Loosen the status check to include 'draft' (and keep all prior values).
alter table public.submissions
  drop constraint if exists submissions_status_check;
alter table public.submissions
  add  constraint submissions_status_check
  check (status in ('draft','submitted','in_review','changes_requested','setup_in_progress','complete'));

-- Default new rows to 'draft' so we can create them at the moment of OTP
-- verification, before the studio finishes the form.
alter table public.submissions
  alter column status set default 'draft';

-- Some columns that were NOT NULL must now be nullable so a draft can exist
-- before the studio fills them in. They are re-validated server-side at submit.
alter table public.submissions alter column plan          drop not null;
alter table public.submissions alter column setup_type    drop not null;
alter table public.submissions alter column studio_name   drop not null;
alter table public.submissions alter column contact_email set not null;

-- Resume + ownership columns
alter table public.submissions add column if not exists region              text check (region in ('AU','US'));
alter table public.submissions add column if not exists last_step_completed integer not null default 0;
alter table public.submissions add column if not exists last_saved_at       timestamptz;
alter table public.submissions add column if not exists verified_at         timestamptz;
alter table public.submissions add column if not exists session_token_hash  text;
alter table public.submissions add column if not exists session_expires_at  timestamptz;
alter table public.submissions add column if not exists submitted_at        timestamptz;

-- One active row per (email, plan, region). Drafts and final submissions
-- coexist without colliding because we treat the row as evolving in place:
-- create as draft, transition to submitted, never duplicate.
create unique index if not exists submissions_email_plan_region_uq
  on public.submissions (lower(contact_email), plan, region)
  where plan is not null and region is not null;

create index if not exists submissions_session_token_idx
  on public.submissions (session_token_hash)
  where session_token_hash is not null;

create index if not exists submissions_status_email_idx
  on public.submissions (status, lower(contact_email));

-- =============================================================================
-- studio_otps: short-lived 6-digit codes for email verification
-- =============================================================================

create table if not exists public.studio_otps (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists studio_otps_email_idx
  on public.studio_otps (lower(email), expires_at desc);

alter table public.studio_otps enable row level security;
-- All access via Edge Functions using the service role. No anon read or write.

-- =============================================================================
-- RLS: anon must NOT read or write submissions directly
-- =============================================================================
-- The original migration allowed anon INSERT on submissions for the public
-- form. That path is now closed. All inserts and updates go through Edge
-- Functions (send-otp -> verify-otp -> save-draft -> submit).
drop policy if exists submissions_insert_anon on public.submissions;

-- =============================================================================
-- Cleanup helper (call manually or via scheduled function)
-- =============================================================================

create or replace function public.purge_expired_drafts(days int default 30)
returns int
language plpgsql
security definer
as $$
declare
  removed int;
begin
  delete from public.submissions
  where status = 'draft'
    and coalesce(last_saved_at, created_at) < now() - (days || ' days')::interval;
  get diagnostics removed = row_count;
  delete from public.studio_otps
  where expires_at < now() - interval '7 days';
  return removed;
end;
$$;
