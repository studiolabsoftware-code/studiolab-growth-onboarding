-- 042_setup_tasks_admin_rls.sql
-- Adds authenticated-role RLS access so the admin panel can read and update
-- setup_tasks rows directly via supabase-js (without going through a custom
-- edge function for every status change). Matches the pattern used for
-- submissions, change_requests, activity_log etc.
--
-- Also installs a trigger that auto-stamps admin_started_at and
-- completed_at when status transitions to in_progress or complete, so the
-- admin UI doesn't have to remember to set those timestamps manually.

drop policy if exists setup_tasks_select_admin on public.setup_tasks;
create policy setup_tasks_select_admin
  on public.setup_tasks
  for select
  to authenticated
  using (true);

drop policy if exists setup_tasks_update_admin on public.setup_tasks;
create policy setup_tasks_update_admin
  on public.setup_tasks
  for update
  to authenticated
  using (true)
  with check (true);

-- Insert is deliberately not granted to authenticated — only the studio
-- (via the service-role edge function) ever creates rows. Admins can update
-- existing rows but cannot back-fill orphan tiles.

create or replace function public.stamp_setup_task_timestamps()
returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.admin_started_at is null then
      new.admin_started_at := now();
    end if;
    if new.status = 'complete' and new.completed_at is null then
      new.completed_at := now();
    end if;
    -- Allow re-opening a tile (admin sets status back to in_progress
    -- after marking complete by mistake) without losing the original
    -- studio_submitted_at audit. We only clear completed_at; admin_started_at
    -- stays as the canonical first-touch timestamp.
    if new.status <> 'complete' then
      new.completed_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_setup_tasks_stamp_ts on public.setup_tasks;
create trigger trg_setup_tasks_stamp_ts
  before update on public.setup_tasks
  for each row execute function public.stamp_setup_task_timestamps();
