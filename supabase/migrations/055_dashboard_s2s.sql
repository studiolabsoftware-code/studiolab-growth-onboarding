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

-- The dashboard path's audit lines. Same anchored method as 052.
do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
  where conrelid = 'public.activity_log'::regclass and conname = 'activity_log_action_check';
  if v_def is null then
    raise exception 'activity_log_action_check not found; refusing to guess its shape.';
  end if;
  if position('app_submission_created' in v_def) > 0 then
    return;
  end if;
  v_new := regexp_replace(v_def, '\]\)\)\)$', ', ''app_submission_created''::text, ''app_answers_saved''::text, ''app_task_saved''::text])))');
  if v_new = v_def then
    raise exception 'Could not extend activity_log_action_check; unexpected shape: %', v_def;
  end if;
  execute 'alter table public.activity_log drop constraint activity_log_action_check';
  execute 'alter table public.activity_log add constraint activity_log_action_check ' || v_new;
end$$;

-- growth_manager.email_event is closed to service_role (Connector 0014), and its read function is not on
-- this database. This gives the sweep the one thing it needs: the last delivery outcome per location.
-- No address, reason or raw event leaves it.
create or replace function public.invite_outcome_for_locations(p_locations text[])
  returns table (location_id text, outcome text)
  language sql stable security definer set search_path = pg_catalog
as $$
  select distinct on (e.location_id) e.location_id, e.event_type::text
  from growth_manager.email_event e
  where e.location_id = any(p_locations)
    and e.event_type::text in ('delivered', 'complained', 'failed_permanent')
  order by e.location_id, e.event_at desc
$$;
revoke all on function public.invite_outcome_for_locations(text[]) from public, anon, authenticated;
grant execute on function public.invite_outcome_for_locations(text[]) to service_role;
