-- Migration 029: document reserved columns on public.quotes.
--
-- The 2026-05-15 audit flagged that quotes.viewed_at and quotes.decline_reason
-- are not populated by any code path. We're keeping them in the schema as a
-- reserved surface for two near-term plans:
--
--   * viewed_at: Stripe quote.viewed event exists but our webhook currently
--     coalesces it into status='viewed' without a timestamp. When we wire up
--     the studio-side Quotes timeline (a "Viewed by recipient on ..." line),
--     we'll backfill viewed_at from the event's status_transitions.
--
--   * decline_reason: Stripe Quotes don't expose a decline reason today, but
--     when we add an in-product "Why declining?" flow on the recipient's side,
--     we'll route that free-text answer here.
--
-- This migration only attaches column comments. It is non-destructive and
-- safe to re-run.

COMMENT ON COLUMN public.quotes.viewed_at IS
  'Reserved. When the studio-side Quotes timeline ships, backfill from Stripe quote.viewed events.';

COMMENT ON COLUMN public.quotes.decline_reason IS
  'Reserved. When an in-product decline-reason capture ships, populate from the recipient flow.';

-- Register the migration so a future supabase db push doesn't try to re-run.
INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('029_quote_columns_reserved')
ON CONFLICT DO NOTHING;
