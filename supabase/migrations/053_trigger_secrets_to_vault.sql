-- =============================================================================
-- Get the service-role JWT out of the trigger definitions, and give the three
-- trigger-target functions real authentication.
-- =============================================================================
-- WHAT WAS WRONG. Three triggers called edge functions via
-- supabase_functions.http_request, with the Authorization header written as a
-- literal in the trigger definition:
--
--     public.submissions  on-submission-trigger  -> on-submission
--     public.submissions  Sync-to-sheet          -> sync-to-sheet
--     public.messages     messages-notify        -> notify-new-message
--
-- Two separate problems, found 2026-08-26:
--
-- 1. A service-role JWT sat in plaintext in pg_trigger, readable by anyone with
--    database read access, and baked into DDL so rotating the key would have
--    silently broken all three.
--
-- 2. Far worse: none of the three functions had ANY application-level auth.
--    Their only gate was the gateway's verify_jwt, which is not authentication
--    here, because the gateway accepts any validly signed project JWT and the
--    publishable key that satisfies it SHIPS IN THE PAGE SOURCE. All three were
--    confirmed reachable with it, answering with their own bodies. on-submission
--    reads `payload.record || payload` and then sends to `row.contact_email`,
--    so anyone who viewed source could make our server send StudioLAB-branded
--    mail from our own Mailgun domain to any address they chose. That is an open
--    relay, and the sending reputation it would burn is the one every real
--    payment receipt depends on.
--
-- THE FIX. Each trigger now calls a plpgsql function that reads the project URL
-- and CRON_SECRET from the Vault, exactly as the cron jobs do since 050/051. The
-- functions themselves now require that secret (isCronCaller), so the gateway
-- check is no longer load-bearing and is switched off for them in config.toml.
--
-- The payload shape is preserved exactly: { type, table, schema, record,
-- old_record }. All three read `record`, and sync-to-sheet also inspects
-- old_record, so this is not a shape a rewrite may casually change.
--
-- ORDER: deploy the three functions BEFORE applying this. Between the deploy and
-- this migration the old triggers present the legacy JWT and are rejected, which
-- is a real but very small window. It is recorded in net._http_response either
-- way, so it fails loudly rather than silently.
-- =============================================================================

create extension if not exists pg_net;

-- Guard: never rewire a trigger to credentials that are missing or placeholders.
do $$
declare
  v_url text;
  v_sec text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'studiolab_project_url';
  select decrypted_secret into v_sec from vault.decrypted_secrets where name = 'studiolab_cron_secret';
  if v_url is null or v_url !~ '^https://[a-z0-9]+\.supabase\.co$' then
    raise exception 'studiolab_project_url missing or malformed (%). Apply 050 first.', v_url;
  end if;
  if v_sec is null or length(v_sec) < 32 or v_sec like 'YOUR-%' then
    raise exception 'studiolab_cron_secret missing or a placeholder. Apply 050 first.';
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- One trigger function per target, so each carries its own function name.
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER because vault.decrypted_secrets is not readable by the roles
-- that INSERT into these tables (anon/authenticated via the edge functions'
-- service client, and the studio-facing paths). search_path is pinned so a
-- shadowed `vault` or `net` schema cannot redirect the secret or the request.
create or replace function public.notify_edge_function()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net, extensions
as $$
declare
  v_fn   text := tg_argv[0];
  v_url  text;
  v_sec  text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'studiolab_project_url';
  select decrypted_secret into v_sec from vault.decrypted_secrets where name = 'studiolab_cron_secret';

  -- Never abort the studio's write because a notification could not be sent.
  -- The INSERT is the studio's data; the webhook is a side effect.
  if v_url is null or v_sec is null then
    raise warning 'notify_edge_function(%): vault secrets missing, webhook skipped', v_fn;
    return null;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/' || v_fn,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_sec,
      'Content-Type', 'application/json'
    ),
    -- The exact Supabase database-webhook shape the functions already parse.
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'schema', tg_table_schema,
      'record', case when tg_op = 'DELETE' then null else to_jsonb(new) end,
      'old_record', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end
    ),
    timeout_milliseconds := 5000
  );
  return null; -- AFTER trigger, return value is ignored
end$$;

revoke all on function public.notify_edge_function() from public;

-- -----------------------------------------------------------------------------
-- Swap the three triggers. Same tables, same timing, same events.
-- -----------------------------------------------------------------------------
drop trigger if exists "on-submission-trigger" on public.submissions;
create trigger "on-submission-trigger"
  after insert on public.submissions
  for each row execute function public.notify_edge_function('on-submission');

drop trigger if exists "Sync-to-sheet" on public.submissions;
create trigger "Sync-to-sheet"
  after insert or update on public.submissions
  for each row execute function public.notify_edge_function('sync-to-sheet');

drop trigger if exists "messages-notify" on public.messages;
create trigger "messages-notify"
  after insert on public.messages
  for each row execute function public.notify_edge_function('notify-new-message');

-- Verify: no trigger definition should contain a bearer token any more.
--   select tgname from pg_trigger
--   where not tgisinternal and pg_get_triggerdef(oid) ilike '%bearer%';
