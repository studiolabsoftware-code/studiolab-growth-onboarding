-- Abandoned-onboarding follow-up (2026-08-20).
--
-- A studio who signs up, opens the form and then stops has no reason to come
-- back on their own: nothing chases them, and the draft simply sits there.
-- This adds the two columns the nudge cron needs to run a short, finite
-- sequence and then stop.
--
-- Deliberately a count plus a timestamp rather than a single "nudged_at"
-- boolean like kb_abandonment_nudged_at. That column can only express "once",
-- and the ask here is a sequence that gives up after three attempts.
--
-- Additive only, so it is contract-safe under the Connector read allow-list.

alter table public.submissions
  add column if not exists onboarding_nudge_count integer not null default 0,
  add column if not exists onboarding_nudged_at   timestamptz;

comment on column public.submissions.onboarding_nudge_count is
  'Abandoned-onboarding follow-ups sent so far. Capped at 3 by nudge-abandoned-onboarding; never reset, so a studio who returns and stalls again is not re-nudged from zero.';
comment on column public.submissions.onboarding_nudged_at is
  'When the most recent abandoned-onboarding follow-up went out. Drives the gap to the next one.';

-- The cron selects unpaid drafts that have gone quiet. This index keeps that
-- scan cheap as the table grows; the partial predicate matches the query.
create index if not exists submissions_onboarding_nudge_idx
  on public.submissions (onboarding_nudge_count, onboarding_nudged_at, last_saved_at)
  where status = 'draft' and payment_status = 'unpaid';
