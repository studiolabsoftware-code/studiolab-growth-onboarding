-- Phase 6 of the Growth onboarding build: knowledge-base intake for the
-- Dominate AI plan. The studio's website is scraped and run through Claude
-- Haiku at Pay-click; the results are written back to the submission so the
-- post-payment KB page opens with everything pre-filled. The studio then
-- confirms, edits, and finishes the session. Admin gets a one-click "Copy
-- KB for GHL" export.
--
-- Columns added here are purely additive — the existing kb_* free-text
-- columns from migration 003 stay; this migration enriches them with
-- a greeting, an assistant-persona choice, and scrape bookkeeping.

-- =============================================================================
-- 1. Assistant persona (how the AI introduces itself)
-- =============================================================================
-- The default is 'studio' — the bot opens with "Hi! Welcome to {StudioName}…".
-- Studios that prefer a personable voice pick 'named' and supply a name like
-- "Casey", which produces "Hi, I'm Casey, the AI assistant for {StudioName}…".
alter table public.submissions
  add column if not exists kb_assistant_persona_type text
    check (kb_assistant_persona_type is null
        or kb_assistant_persona_type in ('studio','named')),
  add column if not exists kb_assistant_persona_name text,
  add column if not exists kb_greeting text;

-- =============================================================================
-- 2. Scrape bookkeeping
-- =============================================================================
-- status: 'pending' the moment the scrape is queued at Pay-click; flips to
-- 'complete' / 'failed' / 'skipped' (no website on file) when the function
-- finishes. 'skipped' submissions surface a "Add your website" callout on
-- the KB page so the studio can still trigger the scrape after payment.
alter table public.submissions
  add column if not exists kb_scrape_status text
    check (kb_scrape_status is null
        or kb_scrape_status in ('pending','complete','failed','skipped'))
    default null,
  add column if not exists kb_scrape_started_at   timestamptz,
  add column if not exists kb_scrape_completed_at timestamptz,
  add column if not exists kb_scrape_error        text,
  add column if not exists kb_scrape_pages_count  integer,
  -- Per-field source tags so the KB page can render "Found on your website"
  -- vs "Standard default" badges, and so a re-trigger (no-website -> add
  -- URL later) never overwrites a field the studio has already edited.
  -- Shape: { "kb_profile": "website", "kb_policies": "default", ... }
  add column if not exists kb_scrape_sources      jsonb,
  -- Studio finished confirming the KB content. Independent of submission
  -- status (which is 'submitted' from the moment Stripe completes); used by
  -- admin to spot "paid but KB still incomplete" rows.
  add column if not exists kb_completed_at        timestamptz;

-- =============================================================================
-- 3. Indexes
-- =============================================================================
-- Pending scrape rows are short-lived; index supports admin "still pending"
-- views and any housekeeping job that wants to spot stuck scrapes.
create index if not exists submissions_kb_scrape_status_idx
  on public.submissions (kb_scrape_status)
  where kb_scrape_status is not null;
