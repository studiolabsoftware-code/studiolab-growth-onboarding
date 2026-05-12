-- StudioLAB Growth Onboarding: Google Sheets sync tracking
-- Run after 003_admin_allowlist_rpc.sql.
--
-- A one-way mirror of submissions to a Google Sheet provides off-platform
-- backup and a permanent record viewable without logging in. The Apps Script
-- web app is the receiver; the sync-to-sheet Edge Function is the pusher.
-- These columns let admins see when a row was last mirrored and surface any
-- sync errors in the admin panel.

alter table public.submissions
  add column if not exists sheets_synced_at timestamptz;

alter table public.submissions
  add column if not exists sheets_sync_error text;

create index if not exists submissions_sheets_synced_at_idx
  on public.submissions (sheets_synced_at);
