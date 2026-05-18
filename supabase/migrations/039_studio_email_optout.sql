-- Migration 039: studio email opt-out.
--
-- Australian Spam Act 2003 (and CAN-SPAM / GDPR equivalents) require an
-- unsubscribe facility on commercial messages. Even though most of what
-- we send to studios is transactional (payment receipts, OTP, account
-- activation), nudges and inbox notifications need a working opt-out.
--
-- Design:
--   * email_notifications_enabled BOOLEAN default true. Studio toggles
--     this from account.html or by clicking the unsubscribe link.
--   * unsubscribe_token TEXT UNIQUE. Stable per studio so any old email
--     link keeps working -- spam law specifically requires the link to
--     remain functional for at least 30 days without authentication.
--   * Two-tier classification at the application layer:
--       Essential intents (OTP, receipts, account activation, responses
--       to explicit studio asks) ALWAYS send regardless of opt-out.
--       Optional intents (inbox notifications, nudges, quote reminders)
--       respect the flag.
--
-- The token is minted on insert via the default expression so every new
-- submission has one immediately. Existing rows get backfilled by the
-- UPDATE at the bottom of this migration.

alter table public.submissions
  add column if not exists email_notifications_enabled boolean not null default true;

-- Per-row stable token. encode(gen_random_bytes(24)) produces a
-- URL-safe-ish 32-character lowercase hex string -- enough entropy
-- (192 bits) that token guessing is infeasible without the DB.
alter table public.submissions
  add column if not exists unsubscribe_token text;

-- Backfill tokens for existing rows. WHERE NULL guard so re-runs are
-- idempotent. Each row gets a distinct token because gen_random_bytes
-- is per-row.
update public.submissions
  set unsubscribe_token = encode(gen_random_bytes(24), 'hex')
  where unsubscribe_token is null;

-- Now that every row has a token we can NOT NULL it and add a UNIQUE
-- constraint. Default expression captures new rows going forward.
alter table public.submissions
  alter column unsubscribe_token set not null,
  alter column unsubscribe_token set default encode(gen_random_bytes(24), 'hex');

create unique index if not exists submissions_unsubscribe_token_idx
  on public.submissions (unsubscribe_token);

-- Index for the common "is this studio opted in?" lookup keyed by
-- contact_email (the lookup path when the gated sender resolves
-- recipients by email).
create index if not exists submissions_optout_lookup_idx
  on public.submissions (contact_email)
  where email_notifications_enabled = false;

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('039_studio_email_optout')
ON CONFLICT DO NOTHING;
