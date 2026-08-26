-- =============================================================================
-- Repoint quote-reminders and cleanup-attachments off the placeholder secret
-- =============================================================================
-- Both jobs were scheduled by migrations 019 and 020 to read two Vault secrets.
-- Both secrets held the placeholder text from 019's own comment block, stored
-- 2026-05-14 by running its "one-time setup" example lines verbatim:
--
--     studiolab_project_url      = 'https://YOUR-PROJECT.supabase.co'
--     studiolab_service_role_key = 'YOUR-SERVICE-ROLE-KEY'
--
-- So neither job had ever reached an edge function. pg_net recorded
-- "Couldn't resolve host name" against a null status code while
-- cron.job_run_details reported 'succeeded', because the SQL itself ran fine.
-- Discovered 2026-08-26 while scheduling stripe-webhook-health (migration 050).
--
-- No data was harmed: `quotes` and `submission_attachments` were both still
-- empty, so there was nothing for either sweep to do. The first quote or
-- attachment would have changed that silently.
--
-- 050 repaired studiolab_project_url and added studiolab_cron_secret. This
-- migration points both jobs at those, matching the two jobs that have always
-- worked (ops-reminders-daily, nudge-abandoned-onboarding-daily). Their edge
-- functions accept CRON_SECRET as of the same change.
--
-- studiolab_service_role_key is deliberately left as-is. Nothing reads it now.
-- =============================================================================

-- Guard: refuse to reschedule against secrets that are still placeholders, so
-- this cannot quietly recreate the exact fault it is fixing.
do $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'studiolab_project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'studiolab_cron_secret';

  if v_url is null or v_url like '%YOUR-PROJECT%' or v_url !~ '^https://[a-z0-9]+\.supabase\.co$' then
    raise exception 'studiolab_project_url is missing or still a placeholder (%). Apply 050 first.', v_url;
  end if;

  if v_secret is null or length(v_secret) < 32 or v_secret like 'YOUR-%' then
    raise exception 'studiolab_cron_secret is missing or still a placeholder. Apply 050 first.';
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- quote-reminders: 09:15-ish Sydney, daily (unchanged cadence)
-- -----------------------------------------------------------------------------
do $$ begin perform cron.unschedule('quote-reminders-daily'); exception when others then null; end$$;

select cron.schedule(
  'quote-reminders-daily',
  '15 22 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'studiolab_project_url') || '/functions/v1/quote-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'studiolab_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);

-- -----------------------------------------------------------------------------
-- cleanup-attachments: 90-day retention sweep, daily (unchanged cadence)
-- -----------------------------------------------------------------------------
do $$ begin perform cron.unschedule('cleanup-attachments-daily'); exception when others then null; end$$;

select cron.schedule(
  'cleanup-attachments-daily',
  '30 22 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'studiolab_project_url') || '/functions/v1/cleanup-attachments',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'studiolab_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cron$
);

-- Both drop 019/020's `case ... else 'skipped'` wrapper, as 050 did. A missing
-- secret now makes url := null raise, and the run is recorded FAILED rather than
-- reported as a success that did nothing.
--
-- Verify after applying, and note that a null status_code with
-- "Couldn't resolve host name" is the exact signature of the fault above:
--   select status_code, error_msg, left(content,160) from net._http_response
--   order by created desc limit 5;
