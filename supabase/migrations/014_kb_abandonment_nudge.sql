-- Phase 7 polish: bookkeeping for the AI knowledge-base abandonment nudge.
-- A studio who pays for Dominate AI but never finishes the KB confirmation
-- gets a reminder email 24h after the scrape lands. The nudge runs once per
-- studio; this column records when (and lets us skip studios who have
-- already been pinged).

alter table public.submissions
  add column if not exists kb_abandonment_nudged_at timestamptz;

-- Supports the daily worker that scans for paid AI studios with a complete
-- scrape but no KB confirmation and no prior nudge.
create index if not exists submissions_kb_nudge_candidate_idx
  on public.submissions (kb_scrape_completed_at)
  where plan = 'ai'
    and payment_status in ('paid','authorised','card_saved')
    and kb_completed_at is null
    and kb_abandonment_nudged_at is null;
