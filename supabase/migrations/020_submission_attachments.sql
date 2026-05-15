-- =============================================================================
-- Submission attachments — form + inbox uploads with status-triggered retention
-- =============================================================================
-- Files attached to a studio submission. Two upload contexts share this one
-- table:
--
--   1. Onboarding form — `message_id` IS NULL. Brand assets, contracts,
--      Google Doc / Excel exports the studio submits as part of their
--      initial onboarding.
--
--   2. Inbox message thread — `message_id` set. Admin requests additional
--      info via the conversation thread; studio replies with files. The
--      attachment is bound to a specific message AND the submission, so it
--      appears inline in the conversation UI AND in the per-submission
--      attachments list.
--
-- RETENTION (memory: project_attachment_retention):
--   * Default `expires_at` = uploaded_at + 90 days (orphan backstop)
--   * When `submissions.status` transitions TO 'complete', a trigger
--     shortens `expires_at` to now() + 7 days (VA grace window)
--   * When status transitions OUT of 'complete' (admin reverted), the
--     trigger restores at least the 90-day orphan window so files don't
--     vanish unexpectedly
--   * The `cleanup-attachments` edge function is cron-scheduled daily;
--     deletes Storage object first, then DB row; retries on next run if
--     Storage fails (`delete_attempted_at` + `delete_failure_reason`)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. submission_attachments
-- -----------------------------------------------------------------------------
create table if not exists public.submission_attachments (
  id                     uuid primary key default gen_random_uuid(),
  submission_id          uuid not null references public.submissions(id) on delete cascade,
  message_id             uuid references public.messages(id) on delete cascade,
  storage_path           text not null unique,
  file_name              text not null,
  mime_type              text not null,
  -- 25 MB cap. Excel files with embedded media + brand-guideline PDFs
  -- can run large; 25 MB covers the realistic ceiling without enabling
  -- abuse uploads.
  size_bytes             bigint not null check (size_bytes > 0 and size_bytes <= 26214400),
  -- Who uploaded. 'studio' = anon studio session; 'admin' = admin acting
  -- on behalf of a studio (e.g. uploading a contract from their side).
  uploaded_by_role       text not null check (uploaded_by_role in ('studio', 'admin')),
  uploaded_by_admin_id   uuid references public.admin_users(id) on delete set null,
  uploaded_at            timestamptz not null default now(),

  -- Retention. The status-change trigger below pulls this forward to
  -- now()+7d when the parent submission completes, or restores the 90-day
  -- window if completion gets reverted. The cleanup-attachments cron
  -- sweeps anything past expires_at daily.
  expires_at             timestamptz not null default (now() + interval '90 days'),

  -- Cron deletion tracking. Set when cron attempts Storage delete; if the
  -- delete fails, the cron sets a reason and skips the row until next
  -- run. A non-null delete_attempted_at indicates the row is past its
  -- expires_at and pending Storage cleanup confirmation.
  delete_attempted_at    timestamptz,
  delete_failure_reason  text
);

create index if not exists sub_attach_submission_idx
  on public.submission_attachments (submission_id);
create index if not exists sub_attach_message_idx
  on public.submission_attachments (message_id)
  where message_id is not null;
create index if not exists sub_attach_expires_idx
  on public.submission_attachments (expires_at)
  where delete_attempted_at is null;
create index if not exists sub_attach_pending_delete_idx
  on public.submission_attachments (delete_attempted_at)
  where delete_attempted_at is not null;

alter table public.submission_attachments enable row level security;

-- Admin reads (admin UI). Inserts + updates + deletes all go through the
-- service-role edge functions; no row-level grant to anon or authenticated.
drop policy if exists sub_attach_select_admin on public.submission_attachments;
create policy sub_attach_select_admin on public.submission_attachments
  for select to authenticated using (true);

-- -----------------------------------------------------------------------------
-- 2. Storage bucket — private, 25 MB cap, allowed mime types enforced at the
--    bucket level as a defense-in-depth backstop to the edge-function check.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submission-attachments',
  'submission-attachments',
  false,
  26214400,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/svg+xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public = excluded.public;

-- Storage RLS: deny anon/authenticated access. Service-role (used by our
-- edge functions) bypasses RLS automatically. Storage rls is enabled on
-- storage.objects by default; without an allow-policy for this bucket,
-- access is denied — which is exactly what we want.
-- (Intentionally no explicit policy here.)

-- -----------------------------------------------------------------------------
-- 3. Status-change trigger: drive expires_at off submissions.status
-- -----------------------------------------------------------------------------
create or replace function public.set_attachment_expiry_on_status_change()
returns trigger
language plpgsql
as $$
begin
  -- Transitioning TO complete: schedule deletion in 7 days (VA grace window).
  -- Override any prior expires_at value — the whole point is to shorten
  -- retention once the studio's onboarding is done.
  if new.status = 'complete' and (old.status is null or old.status is distinct from 'complete') then
    update public.submission_attachments
      set expires_at = now() + interval '7 days'
      where submission_id = new.id;

  -- Transitioning OUT of complete (admin reverted): restore the 90-day
  -- orphan window from uploaded_at. Use greatest() so a manually-extended
  -- expires_at isn't pulled back in.
  elsif (old.status is distinct from new.status)
        and old.status = 'complete'
        and new.status is distinct from 'complete' then
    update public.submission_attachments
      set expires_at = greatest(expires_at, uploaded_at + interval '90 days')
      where submission_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists submission_status_attachment_expiry on public.submissions;
create trigger submission_status_attachment_expiry
  after update of status on public.submissions
  for each row execute function public.set_attachment_expiry_on_status_change();

-- -----------------------------------------------------------------------------
-- 4. Helper view: per-submission attachment summary (admin UI + email digest)
-- -----------------------------------------------------------------------------
-- Surfaces just the columns needed for display, plus a `retention_basis`
-- label so admins can tell at a glance whether the row is on the 7-day
-- post-completion schedule or the 90-day orphan backstop. The label is a
-- heuristic: if expires_at is within 14 days of now, treat as scheduled;
-- otherwise it's on the orphan backstop. Good enough for the UI hint.
create or replace view public.submission_attachments_view as
  select
    a.id,
    a.submission_id,
    a.message_id,
    a.file_name,
    a.mime_type,
    a.size_bytes,
    a.uploaded_by_role,
    a.uploaded_at,
    a.expires_at,
    a.storage_path,
    case
      when a.expires_at <= now() + interval '14 days' then 'scheduled'
      else 'orphan_backstop'
    end as retention_basis,
    a.delete_attempted_at,
    a.delete_failure_reason
  from public.submission_attachments a;

-- -----------------------------------------------------------------------------
-- 5. activity_log: new actions for the attachment lifecycle
-- -----------------------------------------------------------------------------
alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check
  check (action in (
    'submitted','viewed','status_changed','change_request_sent',
    'change_request_completed','note_added','assigned','plan_changed',
    'payment_started','payment_authorised','payment_captured',
    'payment_card_saved','payment_failed','payment_refunded',
    'payment_mode_changed','payment_pricing_changed','payment_session_expired',
    'invoice_issued','invoice_paid','invoice_voided',
    'invoice_refunded','invoice_resent',
    'custom_invoice_sent',
    'quote_drafted','quote_sent','quote_viewed','quote_accepted',
    'quote_declined','quote_expired','quote_revised','quote_reminded',
    'quote_cancelled',
    'external_contact_created','external_contact_invoiced','external_contact_paid',
    -- new in 020:
    'attachment_uploaded','attachment_deleted','attachment_expired'
  ));

-- -----------------------------------------------------------------------------
-- 6. pg_cron schedule for cleanup-attachments
-- -----------------------------------------------------------------------------
-- Daily at 22:30 UTC (08:30 AEST / 09:30 AEDT). 15 minutes after the quote
-- reminders cron so the two jobs don't stomp each other on a busy day.
do $$
begin
  perform cron.unschedule('cleanup-attachments-daily');
exception when others then
  null;
end$$;

select cron.schedule(
  'cleanup-attachments-daily',
  '30 22 * * *',
  $cron$
  select
    case
      when (select count(*) from vault.decrypted_secrets
            where name in ('studiolab_project_url', 'studiolab_service_role_key')) = 2
      then (
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets
                  where name = 'studiolab_project_url') || '/functions/v1/cleanup-attachments',
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
