-- Migration 034: SQL function wrapper around quote_number_seq.
--
-- Supabase RPC doesn't expose Postgres system functions like nextval()
-- directly — calls have to go through user-defined SQL/PLpgSQL functions
-- in a queryable schema. This migration wraps the sequence from
-- migration 033 in a small SECURITY DEFINER function so create-quote can
-- call it via the supabase-js client's `.rpc('next_quote_number')`.
--
-- Returns the formatted number (e.g. 'SLG-Q-0001') directly so the
-- edge function doesn't have to do zero-padding logic itself.
--
-- SECURITY DEFINER + bounded search_path so we don't leak access to the
-- raw nextval / other sequences. Grant execute to service_role only
-- because create-quote runs with the admin client. (anon/authenticated
-- have no business advancing the quote number counter.)

create or replace function public.next_quote_number()
returns text
language sql
security definer
set search_path = pg_catalog, public
as $$
  select 'SLG-Q-' || lpad(nextval('public.quote_number_seq')::text, 4, '0');
$$;

revoke all on function public.next_quote_number() from public;
grant execute on function public.next_quote_number() to service_role;

comment on function public.next_quote_number() is
  'Returns the next SLG-Q-NNNN string and atomically advances quote_number_seq. Called by the create-quote edge function (service_role) at issue time.';

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('034_next_quote_number_fn')
ON CONFLICT DO NOTHING;
