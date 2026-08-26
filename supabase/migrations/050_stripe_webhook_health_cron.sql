-- =============================================================================
-- Schedule the Stripe webhook health check, and repair the vault entries that
-- silently disabled every cron job built on them.
-- =============================================================================
-- BACKGROUND. On 2026-08-11 our Stripe webhook endpoint was deleted from the
-- shared Stripe account. Stripe simply stopped calling. Nothing alerted, because
-- a deleted webhook has no failure mode, and 15 days later a studio paid
-- AUD 768.90 and received nothing from us. `stripe-webhook-health` was written
-- to assert that endpoint's existence, but it was deployed WITHOUT a schedule,
-- so it protected nothing.
--
-- WHAT THIS MIGRATION FOUND. Scheduling it the way migrations 019 and 020 do
-- would not have worked. Those jobs read two Supabase Vault secrets, and both
-- contained the literal placeholder text from 019's own comment block:
--
--     studiolab_project_url      = 'https://YOUR-PROJECT.supabase.co'
--     studiolab_service_role_key = 'YOUR-SERVICE-ROLE-KEY'
--
-- Someone ran the "one-time setup" example lines verbatim on 2026-05-14. So
-- `quote-reminders-daily` and `cleanup-attachments-daily` had fired every day
-- since without ever reaching an edge function: pg_net recorded
-- "Couldn't resolve host name" against a null status code, while
-- cron.job_run_details cheerfully reported 'succeeded' because the SQL itself
-- ran fine. Neither job had done any harm yet only because `quotes` and
-- `submission_attachments` were both still empty.
--
-- THE PATTERN THIS USES INSTEAD. The two cron jobs that demonstrably work in
-- production (`ops-reminders-daily`, `nudge-abandoned-onboarding-daily`) present
-- CRON_SECRET rather than the service-role key. That is both the proven path and
-- the smaller blast radius: a dedicated token scoped to cron endpoints instead of
-- the highest-privilege key in the project. This migration promotes that same
-- token into the vault so it is encrypted at rest rather than sitting in
-- cron.job.command as plaintext.
--
-- NOTE ON SECRECY. This repository is PUBLIC. The token is therefore sourced
-- from the existing cron job inside the database; it is never written into this
-- file. There are no placeholders here to paste by accident, which is the exact
-- defect being corrected.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- -----------------------------------------------------------------------------
-- 1. Repair studiolab_project_url
-- -----------------------------------------------------------------------------
-- The project URL is not a secret; it already appears in plaintext in the
-- working cron commands. It lives in the vault only so the scheduled commands
-- below do not hard-code a project ref.
do $$
declare
  v_id  uuid;
  v_url text := 'https://hiaruvsdamggenhqdvtp.supabase.co';
  v_cur text;
begin
  select id into v_id from vault.secrets where name = 'studiolab_project_url';

  if v_id is null then
    perform vault.create_secret(v_url, 'studiolab_project_url', 'Supabase project URL for pg_cron HTTP calls');
    raise notice 'studiolab_project_url created';
  else
    select decrypted_secret into v_cur from vault.decrypted_secrets where id = v_id;
    if v_cur is distinct from v_url then
      perform vault.update_secret(v_id, v_url);
      raise notice 'studiolab_project_url repaired (was %)', v_cur;
    end if;
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- 2. Promote CRON_SECRET into the vault, sourced from a working cron job
-- -----------------------------------------------------------------------------
-- Idempotent: if a plausible secret is already stored, it is left alone, so
-- re-running this after CRON_SECRET is rotated will NOT clobber the new value.
do $$
declare
  v_id     uuid;
  v_cur    text;
  v_secret text;
begin
  select id into v_id from vault.secrets where name = 'studiolab_cron_secret';
  if v_id is not null then
    select decrypted_secret into v_cur from vault.decrypted_secrets where id = v_id;
  end if;

  -- Already populated with something real? Leave it.
  if v_cur is not null and length(v_cur) >= 32 and v_cur not like 'YOUR-%' then
    raise notice 'studiolab_cron_secret already present, left unchanged';
    return;
  end if;

  select substring(command from 'Bearer ([A-Za-z0-9._-]{32,})')
    into v_secret
  from cron.job
  where jobname in ('ops-reminders-daily', 'nudge-abandoned-onboarding-daily')
    and command ~ 'Bearer [A-Za-z0-9._-]{32,}'
  order by jobid
  limit 1;

  -- Fail loudly. A silent skip here is precisely how 019 and 020 ended up
  -- scheduled-but-dead, and a health check that cannot authenticate is worse
  -- than no health check: it reports nothing and looks like it is working.
  if v_secret is null then
    raise exception
      'Could not source CRON_SECRET from an existing cron job. Set vault secret '
      '''studiolab_cron_secret'' to the CRON_SECRET edge-function env var by hand, then re-run.';
  end if;

  if v_id is null then
    perform vault.create_secret(v_secret, 'studiolab_cron_secret', 'Bearer presented by pg_cron to edge functions');
    raise notice 'studiolab_cron_secret created from existing cron job';
  else
    perform vault.update_secret(v_id, v_secret);
    raise notice 'studiolab_cron_secret repaired from existing cron job';
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- 3. Schedule stripe-webhook-health
-- -----------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('stripe-webhook-health-6h');
exception when others then
  null; -- not scheduled yet
end$$;

-- Every 6 hours at :40 — 00:40, 06:40, 12:40, 18:40 UTC, which is 10:40, 16:40,
-- 22:40 and 04:40 in Sydney, so at least two checks land in business hours.
--
-- WHY NOT HOURLY. The function emails every active admin on EVERY unhealthy run,
-- deliberately, so it stays noisy until someone fixes it. Hourly would mean 24
-- alerts a day for a fault that needs a human in the Stripe dashboard, and an
-- alert that gets muted is an alert that is dead. Six-hourly bounds the silent
-- window at 6 hours (against the 15 days it actually took) while keeping a real
-- outage to 4 emails a day.
--
-- No `case ... else 'skipped'` wrapper here, unlike 019 and 020. If a vault
-- secret is missing, url := null raises and the run is recorded as FAILED in
-- cron.job_run_details. Loud beats tidy: the silent-skip wrapper is why nobody
-- noticed those jobs were dead.
select cron.schedule(
  'stripe-webhook-health-6h',
  '40 */6 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'studiolab_project_url') || '/functions/v1/stripe-webhook-health',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'studiolab_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    -- 019 and 020 omit this and inherit pg_net's 5s default. This check calls the
    -- Stripe API and may then send mail, so 5s can expire before the response is
    -- recorded, leaving no evidence of the outcome either way.
    timeout_milliseconds := 60000
  );
  $cron$
);

-- -----------------------------------------------------------------------------
-- Verify after applying:
--   select jobname, schedule, active from cron.job where jobname = 'stripe-webhook-health-6h';
--   select status_code, error_msg, left(content,200) from net._http_response order by created desc limit 3;
--
-- NOT fixed here, deliberately: `quote-reminders-daily` and
-- `cleanup-attachments-daily` still read studiolab_service_role_key, which is
-- still the placeholder, so both remain dead. Repointing them at CRON_SECRET
-- means changing and redeploying both functions, which is its own slice.
-- -----------------------------------------------------------------------------
