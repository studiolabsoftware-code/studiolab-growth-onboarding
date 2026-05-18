-- Migration 035: add core tables to the supabase_realtime publication.
--
-- Smoke test 2026-05-18: Gary noticed the admin inbox and dashboard never
-- live-update; every new submission, conversation, or inbound message
-- required a manual refresh. Cause: the supabase_realtime publication
-- was empty (zero tables), so every .on('postgres_changes', ...) hook in
-- the admin JS was silently dropped — no events ever fired.
--
-- The publication is the Postgres-side filter that controls which table
-- changes Supabase's realtime broadcaster forwards to subscribers.
-- Empty publication = zero broadcasts. We need to add the tables the
-- admin UI actually subscribes to. Other tables can be added later if
-- new realtime surfaces ship; keep this list minimal so we don't broadcast
-- unnecessary churn.
--
-- Tables added:
--   * submissions     — dashboard list live-refresh on new submissions
--                       and status changes (admin/js/dashboard.js)
--   * conversations   — inbox list live-refresh + unread-count updates
--                       (admin/js/inbox.js)
--   * messages        — open thread live-refresh on inbound and outbound
--                       sends (admin/js/inbox.js, detail.js)
--
-- ALTER PUBLICATION is idempotent only via the DO block guard since
-- "ADD TABLE" fails if the table is already a member.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'submissions'
  ) then
    alter publication supabase_realtime add table public.submissions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('035_realtime_publication')
ON CONFLICT DO NOTHING;
