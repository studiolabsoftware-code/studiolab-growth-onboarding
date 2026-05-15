-- =============================================================================
-- Quote reminder cron + external-contact linkage on quotes
-- =============================================================================
-- Two changes that ship together because the cron depends on the schema bit:
--
--  1. ADD COLUMN public.quotes.external_contact_id
--     The original quotes table (migration 016) only carries submission_id.
--     create-quote resolves an external recipient via external_contacts but
--     never stored the linkage on the quote row, so the reminder cron had no
--     way to look up the recipient's email. This column closes that gap
--     symmetrically with invoices.external_contact_id (migration 017).
--
--  2. pg_cron schedule for the quote-reminders edge function
--     Runs daily at 09:15 Sydney time. The job uses pg_net to POST to the
--     edge function with the service-role bearer token so the function can
--     act on every quote in the ledger. The function itself is idempotent —
--     each side-effect is gated on a "_sent_at" column or on status — so
--     running twice in the same day is a no-op for already-handled quotes.
--
-- Secrets are stored in Supabase Vault (one-time setup documented in the
-- deploy notes). The schedule reads them at run time so there are no
-- hard-coded tokens in source control. If the vault secrets aren't present
-- the cron job logs and skips; nothing breaks.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. external_contact_id on quotes
-- -----------------------------------------------------------------------------
alter table public.quotes
  add column if not exists external_contact_id uuid;

alter table public.quotes
  drop constraint if exists quotes_external_contact_fk;
alter table public.quotes
  add constraint quotes_external_contact_fk
  foreign key (external_contact_id) references public.external_contacts(id) on delete set null;

create index if not exists quotes_external_contact_idx
  on public.quotes (external_contact_id)
  where external_contact_id is not null;

-- A quote must attach to at least one of: submission or external contact.
-- Enforced at the application layer (create-quote validates the recipient
-- shape), not as a CHECK, because draft quotes created via the Stripe
-- dashboard outside our flow may legitimately have neither.

-- -----------------------------------------------------------------------------
-- 2. pg_cron + pg_net for the quote-reminders sweep
-- -----------------------------------------------------------------------------
-- These extensions ship enabled on Supabase Pro by default; on free tier
-- they require enabling via the dashboard before this migration will succeed.
-- We use CREATE EXTENSION IF NOT EXISTS so re-runs are safe.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Unschedule any prior version of this job so re-running the migration
-- replaces the schedule cleanly (cron.schedule with an existing name fails).
do $$
begin
  perform cron.unschedule('quote-reminders-daily');
exception when others then
  -- Job didn't exist yet; ignore.
  null;
end$$;

-- 09:15 Sydney time daily. Stored in UTC: AEST = UTC+10, AEDT = UTC+11.
-- We use 22:15 UTC which is 08:15 AEST and 09:15 AEDT — close enough
-- year-round, and the function's idempotency means a 1-hour drift across
-- DST changes is fine.
select cron.schedule(
  'quote-reminders-daily',
  '15 22 * * *',
  $cron$
  select
    case
      when (select count(*) from vault.decrypted_secrets
            where name in ('studiolab_project_url', 'studiolab_service_role_key')) = 2
      then (
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'studiolab_project_url') || '/functions/v1/quote-reminders',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                           where name = 'studiolab_service_role_key'),
            'Content-Type', 'application/json'
          ),
          body := jsonb_build_object()
        )::text
      )
      else 'skipped: studiolab_project_url or studiolab_service_role_key missing from vault'
    end
  $cron$
);

-- -----------------------------------------------------------------------------
-- One-time vault setup (run these by hand once per environment, NOT in this
-- migration — the secrets must not be committed to source control):
--
--   select vault.create_secret('https://YOUR-PROJECT.supabase.co', 'studiolab_project_url');
--   select vault.create_secret('YOUR-SERVICE-ROLE-KEY',           'studiolab_service_role_key');
--
-- To verify the schedule is registered after deploy:
--   select jobid, schedule, command from cron.job where jobname = 'quote-reminders-daily';
--
-- To manually trigger the sweep without waiting for the schedule:
--   curl -X POST 'https://YOUR-PROJECT.supabase.co/functions/v1/quote-reminders' \
--     -H 'Authorization: Bearer YOUR-SERVICE-ROLE-KEY' \
--     -H 'Content-Type: application/json' \
--     -d '{}'
-- -----------------------------------------------------------------------------
