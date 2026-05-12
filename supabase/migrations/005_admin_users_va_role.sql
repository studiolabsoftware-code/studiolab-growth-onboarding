-- Phase 1 of the admin panel rebuild: add 'va' role + invite metadata to
-- admin_users, and expose a tiny RPC the dashboard can call to fetch the
-- current admin's profile (role/name) without having to read the table from
-- the client.

-- 1. Drop the existing role check and add the broader one
alter table public.admin_users
  drop constraint if exists admin_users_role_check;

alter table public.admin_users
  add constraint admin_users_role_check
  check (role in ('owner', 'admin', 'va'));

-- 2. Invite metadata
alter table public.admin_users
  add column if not exists invited_by    uuid references public.admin_users(id) on delete set null,
  add column if not exists last_login_at timestamptz;

create index if not exists admin_users_email_lower_idx on public.admin_users (lower(email));

-- 3. RLS: tighten so only owners can manage the user list. All authenticated
--    admins keep read access (needed for the role-aware UI and assignment
--    dropdowns later).
drop policy if exists admin_users_select       on public.admin_users;
drop policy if exists admin_users_insert_owner on public.admin_users;
drop policy if exists admin_users_update_owner on public.admin_users;
drop policy if exists admin_users_delete_owner on public.admin_users;

create policy admin_users_select on public.admin_users
  for select to authenticated using (true);

-- Owner-only write policies. The owner check reads the caller's row in
-- admin_users via auth.email() — RLS on this table allows it because the
-- select policy above lets every authenticated admin read.
create policy admin_users_insert_owner on public.admin_users
  for insert to authenticated
  with check (
    exists (
      select 1 from public.admin_users me
      where lower(me.email) = lower(auth.email())
        and me.role = 'owner'
        and me.is_active = true
    )
  );

create policy admin_users_update_owner on public.admin_users
  for update to authenticated
  using (
    exists (
      select 1 from public.admin_users me
      where lower(me.email) = lower(auth.email())
        and me.role = 'owner'
        and me.is_active = true
    )
  )
  with check (true);

create policy admin_users_delete_owner on public.admin_users
  for delete to authenticated
  using (
    exists (
      select 1 from public.admin_users me
      where lower(me.email) = lower(auth.email())
        and me.role = 'owner'
        and me.is_active = true
    )
  );

-- 4. RPC: return the current caller's admin profile. Used by the dashboard
--    to gate UI based on role without leaking the table shape to the client.
create or replace function public.get_admin_profile()
returns table (
  id            uuid,
  email         text,
  name          text,
  role          text,
  is_active     boolean,
  last_login_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select id, email, name, role, is_active, last_login_at
  from public.admin_users
  where lower(email) = lower(auth.email())
  limit 1;
$$;

grant execute on function public.get_admin_profile() to authenticated;
