-- 055: the dashboard's server-to-server path (onboarding plan, sections 4 and 5).
--
-- ADDITIVE. Applied by hand like every migration here. Nothing existing changes meaning. RLS on with no
-- policies means only the service role reads these, which is the only caller.

-- Stored nonces: a signed request is accepted once. Kept just past the skew window.
create table if not exists public.s2s_nonce (
  nonce      text primary key,
  expires_at timestamptz not null
);
alter table public.s2s_nonce enable row level security;
create index if not exists s2s_nonce_expires_idx on public.s2s_nonce (expires_at);

-- One submission per sub-account. Checked on 2 Nov: no row carries a location_id yet, so this builds clean.
-- This is what makes find-or-create safe against two tabs, and it replaces 048's plain index.
create unique index if not exists submissions_location_id_uq
  on public.submissions (location_id)
  where location_id is not null;
drop index if exists public.submissions_location_id_idx;

-- A studio waiting on a third party for one tile, so the wait can be shown and an overrun raised.
-- The status column is unchanged, so the Setup Queue reads what it always read.
alter table public.setup_tasks
  add column if not exists waiting_on    text,
  add column if not exists waiting_since timestamptz;

-- Stalled-studio flags raised by the dashboard's daily sweep, for our own team. A flag stays open while its
-- cause holds: closing it by the email button stops reminders, and it can only fire again after it clears.
create table if not exists public.setup_stall_flags (
  id              uuid primary key default gen_random_uuid(),
  location_id     text not null,
  flag            text not null,
  opened_at       timestamptz not null default now(),
  cleared_at      timestamptz,
  closed_at       timestamptz,
  last_emailed_at timestamptz,
  emails_sent     integer not null default 0,
  done_token      text not null unique
);
alter table public.setup_stall_flags enable row level security;
create unique index if not exists setup_stall_flags_one_live_uq
  on public.setup_stall_flags (location_id, flag)
  where cleared_at is null;
