-- Migration 033: SLG-Q-NNNN quote numbering sequence.
--
-- Stripe Quotes don't expose a dashboard prefix setting (unlike invoices,
-- which inherit the account-level prefix from Settings -> Billing -> Invoice
-- template). To get the SLG-Q-NNNN format documented in memory
-- project_stripe_numbering, we mint the number ourselves and pass it as
-- `number` on POST /v1/quotes.
--
-- This sequence is the source of truth for the NNNN portion. nextval() is
-- atomic in PostgreSQL so concurrent create-quote calls cannot collide.
-- Starts at 1 so the first live quote is SLG-Q-0001. Sequence values are
-- never reused even if a quote create fails after nextval (acceptable —
-- means production may show small gaps, e.g. SLG-Q-0003 then SLG-Q-0005,
-- which is normal for any append-only numbering system).

create sequence if not exists public.quote_number_seq
  start with 1
  increment by 1
  no maxvalue
  no cycle
  cache 1;

comment on sequence public.quote_number_seq is
  'Source of truth for the NNNN portion of SLG-Q-NNNN quote numbers. Used by create-quote at issue time. Atomic nextval(); gaps acceptable on failed creates.';

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('033_quote_number_sequence')
ON CONFLICT DO NOTHING;
