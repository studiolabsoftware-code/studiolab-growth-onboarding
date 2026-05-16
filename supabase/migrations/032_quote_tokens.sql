-- Migration 032: add token + token_expires_at to quotes for the client
-- accept portal.
--
-- Stripe removed POST /v1/quotes/{id}/send (returns 404 in the current API)
-- and the Stripe-hosted quote-accept page is no longer available. The new
-- pattern: WE email the recipient with a link to our own quote review page
-- (quote.html), authenticated by a long random URL token stored on the
-- quote row (mirrors projects.token from migration 025).
--
-- Token TTL matches the project portal default: 90 days from issue. After
-- expiry the link returns the standard "this link is no longer valid"
-- view. Tokens are also revoked implicitly when the quote moves to a
-- terminal status (accepted / declined / cancelled / expired / revised) —
-- portal-quote checks status as well as expiry.

alter table public.quotes
  add column if not exists token text,
  add column if not exists token_expires_at timestamptz;

-- Partial index so the token lookup stays cheap. Only quotes that have
-- been issued ever carry a token, so the index is small.
create index if not exists quotes_token_idx
  on public.quotes (token)
  where token is not null;

comment on column public.quotes.token is
  'Client portal token. 64-char hex string emailed to the recipient as ?t= in the quote.html URL. Null until create-quote mints one.';
comment on column public.quotes.token_expires_at is
  'Default 90 days from issue, mirrors projects.token_expires_at. Set together with token.';

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('032_quote_tokens')
ON CONFLICT DO NOTHING;
