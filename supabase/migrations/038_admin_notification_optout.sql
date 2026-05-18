-- Migration 038: per-admin notification opt-out.
--
-- Adds a global toggle on admin_users so owners can silence VAs on
-- holiday and any admin can opt themselves out of system emails
-- without leaving the team. The toggle is intentionally global rather
-- than per-event-type for MVP -- per-event granularity is a v2 once
-- we see which categories actually generate noise.
--
-- Opt-out model (default true). Existing rows keep receiving emails
-- without any backfill; an explicit false silences the user across
-- every notification path that reads admin_users.

alter table public.admin_users
  add column if not exists email_notifications_enabled boolean not null default true;

-- Filtered partial index because the common query path is "give me the
-- enabled, active admins" -- the filtered shape keeps it tight as the
-- table grows.
create index if not exists admin_users_notify_enabled_idx
  on public.admin_users (id)
  where is_active = true and email_notifications_enabled = true;

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('038_admin_notification_optout')
ON CONFLICT DO NOTHING;
