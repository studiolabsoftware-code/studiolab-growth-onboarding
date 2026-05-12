-- StudioLAB Growth Onboarding: admin allowlist check (anon-callable RPC)
-- Run after 002_drafts_and_otps.sql.
--
-- The admin sign-in flow needs to pre-check whether an email is on the
-- admin_users allowlist before asking Supabase Auth to mint a magic-link
-- token. With RLS, anon cannot read admin_users directly. This RPC runs
-- with security definer so the check works for anon callers without
-- exposing the table contents.

create or replace function public.is_admin_email(p_email text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where lower(email) = lower(p_email)
      and is_active = true
  );
$$;

grant execute on function public.is_admin_email(text) to anon, authenticated;
