-- Migration 036: activation status + timestamp.
--
-- Phase 7 of the post-payment portal completeness pass introduces a
-- terminal "active" status that the studio sees on their account.html
-- as the cue that onboarding is finished and communication moves to the
-- GHL platform itself. Admin flips this via a "Mark as active" button in
-- detail.js once the account is live.
--
-- 1. Relax the CHECK constraint to accept the new value.
-- 2. Add activated_at so we can record exactly when it happened and
--    show "Active since X" on the studio's portal copy.

alter table public.submissions
  drop constraint if exists submissions_status_check;

-- 'draft' is included to match rows that predate the original constraint
-- (the live DB has at least one such row; save-draft also treats draft as
-- a valid pre-submit state). 'active' is the new terminal state added by
-- this migration for the admin "Mark as active" flow.
alter table public.submissions
  add constraint submissions_status_check
  check (status in ('draft','submitted','in_review','changes_requested','setup_in_progress','complete','active'));

alter table public.submissions
  add column if not exists activated_at timestamptz;

create index if not exists submissions_activated_at_idx
  on public.submissions (activated_at)
  where activated_at is not null;

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('036_activation_status')
ON CONFLICT DO NOTHING;
