-- 043_setup_nudge_tracking.sql
-- Tracks the last time we sent a Setup Checklist nudge email to a
-- studio, so the scheduled cron doesn't spam anyone. One column on
-- submissions keeps the schema simple; cadence (e.g. 5-day throttle,
-- escalating to weekly after the third send) is enforced in the
-- function, not the schema.

alter table public.submissions
  add column if not exists setup_last_nudge_at  timestamptz,
  add column if not exists setup_nudge_count    integer not null default 0;

comment on column public.submissions.setup_last_nudge_at is
  'Last time the Setup Checklist nudge function emailed this studio. Throttles repeat sends. Null = never nudged.';
comment on column public.submissions.setup_nudge_count is
  'Number of nudges sent total. Used by the function to decide how aggressive the next cadence should be (early sends every few days, later sends weekly).';
