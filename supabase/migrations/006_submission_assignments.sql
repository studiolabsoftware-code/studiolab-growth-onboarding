-- Phase 2: structured per-submission assignment model.
--
-- Replaces the free-text `submissions.assigned_to` field with rows in
-- submission_assignments. One ACTIVE assignment per submission at a time
-- (enforced by a partial unique index). Reassigning cancels the prior active
-- row automatically via a BEFORE INSERT trigger.

create table if not exists public.submission_assignments (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete restrict,
  status        text not null default 'assigned'
                  check (status in ('assigned','in_progress','needs_recheck','completed','cancelled')),
  notes         text,
  assigned_by   uuid references public.admin_users(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  last_sent_at  timestamptz,
  completed_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create index if not exists submission_assignments_submission_idx
  on public.submission_assignments(submission_id);
create index if not exists submission_assignments_admin_idx
  on public.submission_assignments(admin_user_id);

-- One ACTIVE assignment per submission (active = not cancelled, not completed)
create unique index if not exists submission_assignments_active_uniq
  on public.submission_assignments (submission_id)
  where status in ('assigned','in_progress','needs_recheck');

-- ── Triggers ─────────────────────────────────────────────────────────────

-- Keep updated_at fresh
create or replace function public.sa_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists sa_touch on public.submission_assignments;
create trigger sa_touch before update on public.submission_assignments
  for each row execute function public.sa_touch_updated_at();

-- Cancel any prior active assignment when a new active one is inserted, so
-- the partial unique index is respected without forcing the client to do
-- two-step updates.
create or replace function public.sa_cancel_prior_active()
returns trigger language plpgsql as $$
begin
  if new.status in ('assigned','in_progress','needs_recheck') then
    update public.submission_assignments
       set status = 'cancelled', updated_at = now()
     where submission_id = new.submission_id
       and status in ('assigned','in_progress','needs_recheck');
  end if;
  return new;
end;
$$;
drop trigger if exists sa_cancel_prior on public.submission_assignments;
create trigger sa_cancel_prior before insert on public.submission_assignments
  for each row execute function public.sa_cancel_prior_active();

-- Stamp completed_at when status flips to 'completed'
create or replace function public.sa_stamp_completed()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') then
    new.completed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists sa_stamp_completed_trg on public.submission_assignments;
create trigger sa_stamp_completed_trg before update on public.submission_assignments
  for each row execute function public.sa_stamp_completed();

-- ── RLS ──────────────────────────────────────────────────────────────────

alter table public.submission_assignments enable row level security;

drop policy if exists sa_select_authed on public.submission_assignments;
drop policy if exists sa_insert_admin  on public.submission_assignments;
drop policy if exists sa_update_admin  on public.submission_assignments;
drop policy if exists sa_delete_admin  on public.submission_assignments;

create policy sa_select_authed on public.submission_assignments
  for select to authenticated using (true);

create policy sa_insert_admin on public.submission_assignments
  for insert to authenticated
  with check (
    exists (
      select 1 from public.admin_users me
      where lower(me.email) = lower(auth.email())
        and me.role in ('owner','admin')
        and me.is_active = true
    )
  );

create policy sa_update_admin on public.submission_assignments
  for update to authenticated
  using (
    exists (
      select 1 from public.admin_users me
      where lower(me.email) = lower(auth.email())
        and me.role in ('owner','admin')
        and me.is_active = true
    )
  )
  with check (true);

create policy sa_delete_admin on public.submission_assignments
  for delete to authenticated
  using (
    exists (
      select 1 from public.admin_users me
      where lower(me.email) = lower(auth.email())
        and me.role in ('owner','admin')
        and me.is_active = true
    )
  );

-- ── VA self-update RPC ──────────────────────────────────────────────────

-- VAs can flip their own active assignment between in_progress / completed /
-- needs_recheck via this RPC. They cannot touch assignments belonging to
-- other VAs or escalate to cancel/reassign.
create or replace function public.va_update_my_assignment(
  p_assignment_id uuid,
  p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_owner   uuid;
begin
  if p_status not in ('in_progress','needs_recheck','completed') then
    raise exception 'Invalid status: %', p_status;
  end if;

  v_email := auth.email();
  if v_email is null then raise exception 'Not authenticated.'; end if;

  select admin_user_id into v_owner
    from public.submission_assignments
   where id = p_assignment_id;
  if v_owner is null then raise exception 'Assignment not found.'; end if;

  perform 1 from public.admin_users
   where id = v_owner
     and lower(email) = lower(v_email)
     and is_active = true;
  if not found then raise exception 'You are not the assignee.'; end if;

  update public.submission_assignments
     set status = p_status
   where id = p_assignment_id;
end;
$$;
grant execute on function public.va_update_my_assignment(uuid, text) to authenticated;

-- ── RPC: list submission ids assigned to current user (active only) ─────

create or replace function public.my_assigned_submission_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select sa.submission_id
  from public.submission_assignments sa
  join public.admin_users au on au.id = sa.admin_user_id
  where sa.status in ('assigned','in_progress','needs_recheck')
    and lower(au.email) = lower(auth.email());
$$;
grant execute on function public.my_assigned_submission_ids() to authenticated;

-- ── Backfill from the old free-text submissions.assigned_to ─────────────

insert into public.submission_assignments (submission_id, admin_user_id, status, assigned_at, assigned_by)
select s.id, au.id, 'assigned', s.created_at, null
from public.submissions s
join public.admin_users au on lower(au.email) = lower(trim(s.assigned_to))
where s.assigned_to is not null
  and trim(s.assigned_to) <> ''
  and s.status <> 'complete'
  and not exists (
    select 1 from public.submission_assignments sa
    where sa.submission_id = s.id
      and sa.status in ('assigned','in_progress','needs_recheck')
  );
