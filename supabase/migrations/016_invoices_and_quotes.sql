-- =============================================================================
-- Invoices ledger, invoice events audit log, quotes ledger
-- =============================================================================
-- Two new ledgers sitting on top of the Stripe billing already wired in 009:
--
-- * `invoices` is the append-once-mutate-on-event record of every document
--   we issue — setup fees from the onboarding catalog, ad-hoc custom charges
--   the admin team raises, and invoices that result from accepted quotes.
--   The submission row already carries a single (stripe_invoice_id,
--   invoice_hosted_url, invoice_pdf_url) trio; that handles the live setup
--   payment but cannot represent the full sequence (authorisation → capture →
--   refund → re-bill) and cannot represent multiple ad-hoc invoices on one
--   account. The ledger does both.
--
-- * `quotes` captures the quote-to-invoice lifecycle for ad-hoc work
--   ("what would it take to do X?"). Built on Stripe's Quotes API; accept-
--   and-pay is the default acceptance mode (see memory:
--   project_quote_acceptance_default).
--
-- HARD SEPARATION FROM GHL SAAS BILLING. The Stripe account is shared with
-- the GHL SaaS Configurator. Every row in these tables carries a `source`
-- column whose value is one of three StudioLAB-Growth-owned tags. The
-- stripe-webhook handler MUST filter by `metadata.source` on every invoice
-- event before touching either ledger; GHL subscription invoices are
-- silently ignored. See memory: project_billing_separation_rules.
-- =============================================================================

-- =============================================================================
-- 1. submissions: acquisition source for revenue-by-channel reporting
-- =============================================================================
-- Stamped at draft creation (URL param, partner code, organic) so the
-- revenue dashboard can slice by where the studio came from without joining
-- through to discount_codes.
alter table public.submissions
  add column if not exists acquisition_source text;

create index if not exists submissions_acquisition_source_idx
  on public.submissions (acquisition_source)
  where acquisition_source is not null;

-- =============================================================================
-- 2. invoices — the source of truth for finance reporting
-- =============================================================================
-- One row per Stripe Invoice that *we* create. GHL SaaS subscription
-- invoices never land here — the webhook filter sees to that. Refunds and
-- credit notes create their own rows linked back to the original via
-- `parent_invoice_id` so the lineage is preserved.
create table if not exists public.invoices (
  id                       uuid primary key default gen_random_uuid(),
  submission_id            uuid references public.submissions(id) on delete set null,
  stripe_invoice_id        text unique,
  stripe_payment_intent_id text,
  stripe_customer_id       text,
  number                   text,                 -- Stripe-issued, e.g. SLG-0042
  kind                     text not null
    check (kind in ('setup_invoice','custom_charge','quote_invoice','credit_note')),
  -- Provenance tag. The webhook filter and admin-action guards key on this
  -- to prevent any operation on GHL's SaaS subscription invoices.
  source                   text not null
    check (source in (
      'studiolab-growth-setup',
      'studiolab-growth-custom',
      'studiolab-growth-quote'
    )),
  status                   text not null default 'draft'
    check (status in (
      'draft','open','paid','voided','uncollectible','refunded','partially_refunded'
    )),
  currency                 text not null check (currency in ('AUD','USD')),
  subtotal_cents           integer not null default 0 check (subtotal_cents >= 0),
  discount_cents           integer not null default 0 check (discount_cents >= 0),
  tax_cents                integer not null default 0 check (tax_cents >= 0),
  total_cents              integer not null default 0 check (total_cents >= 0),
  amount_paid_cents        integer not null default 0 check (amount_paid_cents >= 0),
  amount_remaining_cents   integer not null default 0 check (amount_remaining_cents >= 0),
  amount_refunded_cents    integer not null default 0 check (amount_refunded_cents >= 0),
  -- Document lifecycle timestamps; populated as Stripe fires the events.
  issued_at                timestamptz,
  due_at                   timestamptz,
  paid_at                  timestamptz,
  voided_at                timestamptz,
  refunded_at              timestamptz,
  hosted_url               text,
  pdf_url                  text,
  description              text,                 -- internal admin note
  collection_method        text
    check (collection_method is null or collection_method in ('charge_automatically','send_invoice')),
  quote_id                 uuid,                 -- forward ref to quotes(id)
  parent_invoice_id        uuid references public.invoices(id) on delete set null,
  created_by               uuid references public.admin_users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists invoices_submission_idx
  on public.invoices (submission_id);
create index if not exists invoices_status_idx
  on public.invoices (status, issued_at desc);
create index if not exists invoices_kind_idx
  on public.invoices (kind, issued_at desc);
create index if not exists invoices_source_idx
  on public.invoices (source);
create index if not exists invoices_currency_idx
  on public.invoices (currency, issued_at desc);
create index if not exists invoices_stripe_customer_idx
  on public.invoices (stripe_customer_id)
  where stripe_customer_id is not null;
create index if not exists invoices_quote_idx
  on public.invoices (quote_id)
  where quote_id is not null;
create index if not exists invoices_parent_idx
  on public.invoices (parent_invoice_id)
  where parent_invoice_id is not null;

drop trigger if exists invoices_set_updated_at on public.invoices;
create trigger invoices_set_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

drop policy if exists invoices_select_admin on public.invoices;
create policy invoices_select_admin on public.invoices
  for select to authenticated using (true);

-- =============================================================================
-- 3. invoice_events — audit log of every Stripe webhook touch
-- =============================================================================
-- Different from stripe_events (which is the per-event idempotency table)
-- because this is scoped to a specific invoice row. Lets us reconstruct the
-- exact sequence of Stripe events that produced the current invoice state
-- without re-querying Stripe.
create table if not exists public.invoice_events (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  stripe_event_id   text,
  type              text not null,                -- Stripe event type
  payload           jsonb,
  received_at       timestamptz not null default now()
);

create index if not exists invoice_events_invoice_idx
  on public.invoice_events (invoice_id, received_at desc);
create index if not exists invoice_events_stripe_event_idx
  on public.invoice_events (stripe_event_id)
  where stripe_event_id is not null;

alter table public.invoice_events enable row level security;

drop policy if exists invoice_events_select_admin on public.invoice_events;
create policy invoice_events_select_admin on public.invoice_events
  for select to authenticated using (true);

-- =============================================================================
-- 4. quotes — quote-to-invoice lifecycle for ad-hoc work
-- =============================================================================
-- One row per Stripe Quote. Acceptance produces a Stripe Invoice which is
-- written to `invoices` and linked back via `resulting_invoice_id`.
-- Revisions are modelled as new rows with `parent_quote_id` pointing to the
-- prior version; the prior version's status becomes 'revised'.
create table if not exists public.quotes (
  id                       uuid primary key default gen_random_uuid(),
  submission_id            uuid references public.submissions(id) on delete set null,
  stripe_quote_id          text unique,
  stripe_customer_id       text,
  number                   text,                 -- Stripe-issued, e.g. SLG-Q-0042
  -- Always 'studiolab-growth-quote'. Encoded as a column (not implied) for
  -- the same webhook/admin-action filtering pattern as `invoices.source`.
  source                   text not null default 'studiolab-growth-quote'
    check (source = 'studiolab-growth-quote'),
  status                   text not null default 'draft'
    check (status in (
      'draft','sent','viewed','accepted','declined','expired','cancelled','revised'
    )),
  parent_quote_id          uuid references public.quotes(id) on delete set null,
  -- Acceptance mode: default 'pay_on_accept' (memory:
  -- project_quote_acceptance_default). 'pay_on_invoice' is admin opt-in for
  -- larger engagements where the studio's owner needs to approve internally
  -- before paying.
  acceptance_mode          text not null default 'pay_on_accept'
    check (acceptance_mode in ('pay_on_accept','pay_on_invoice')),
  currency                 text not null check (currency in ('AUD','USD')),
  subtotal_cents           integer not null default 0 check (subtotal_cents >= 0),
  tax_cents                integer not null default 0 check (tax_cents >= 0),
  total_cents              integer not null default 0 check (total_cents >= 0),
  expires_at               timestamptz,
  sent_at                  timestamptz,
  viewed_at                timestamptz,
  accepted_at              timestamptz,
  declined_at              timestamptz,
  decline_reason           text,
  resulting_invoice_id     uuid references public.invoices(id) on delete set null,
  hosted_url               text,
  pdf_url                  text,
  description              text,                 -- internal admin note
  cover_note               text,                 -- studio-facing, shown on the quote
  reminder_sent_at         timestamptz,          -- last automated nudge (day 7)
  expiry_warning_sent_at   timestamptz,          -- warning at expiry-minus-5
  created_by               uuid references public.admin_users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists quotes_submission_idx
  on public.quotes (submission_id);
create index if not exists quotes_status_idx
  on public.quotes (status, sent_at desc);
create index if not exists quotes_currency_idx
  on public.quotes (currency, sent_at desc);
create index if not exists quotes_stripe_customer_idx
  on public.quotes (stripe_customer_id)
  where stripe_customer_id is not null;
create index if not exists quotes_expires_at_idx
  on public.quotes (expires_at)
  where expires_at is not null and status in ('sent','viewed');
create index if not exists quotes_parent_idx
  on public.quotes (parent_quote_id)
  where parent_quote_id is not null;

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

alter table public.quotes enable row level security;

drop policy if exists quotes_select_admin on public.quotes;
create policy quotes_select_admin on public.quotes
  for select to authenticated using (true);

-- Now that `quotes.id` exists, wire the forward reference from `invoices`.
alter table public.invoices
  drop constraint if exists invoices_quote_id_fkey;
alter table public.invoices
  add constraint invoices_quote_id_fkey
  foreign key (quote_id) references public.quotes(id) on delete set null;

-- =============================================================================
-- 5. activity_log: new action types for invoices, quotes, and custom charges
-- =============================================================================
-- Replace the action CHECK to add the new lifecycle actions. Preserves every
-- existing action from migrations 001–009.
alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check
  check (action in (
    -- existing pre-billing
    'submitted','viewed','status_changed','change_request_sent',
    'change_request_completed','note_added','assigned','plan_changed',
    -- existing billing (migration 009)
    'payment_started','payment_authorised','payment_captured',
    'payment_card_saved','payment_failed','payment_refunded',
    'payment_mode_changed','payment_pricing_changed','payment_session_expired',
    -- new in 016: invoices ledger
    'invoice_issued','invoice_paid','invoice_voided',
    'invoice_refunded','invoice_resent',
    -- new in 016: custom charges (admin-initiated invoices)
    'custom_invoice_sent',
    -- new in 016: quotes lifecycle
    'quote_drafted','quote_sent','quote_viewed','quote_accepted',
    'quote_declined','quote_expired','quote_revised','quote_reminded',
    'quote_cancelled'
  ));

-- =============================================================================
-- 6. Revenue reporting views
-- =============================================================================
-- A pair of views the admin Revenue page can query directly without
-- reaching for raw rows. Both keep AUD and USD strictly separate — no fake
-- combined total computed via a stale FX rate.

drop view if exists public.revenue_collected;
create view public.revenue_collected as
  select
    date_trunc('month', paid_at) as period_month,
    currency,
    kind,
    count(*)                       as invoice_count,
    sum(total_cents)               as gross_cents,
    sum(amount_refunded_cents)     as refunded_cents,
    sum(total_cents - amount_refunded_cents) as net_cents
  from public.invoices
  where status in ('paid','partially_refunded','refunded')
    and paid_at is not null
  group by 1, 2, 3;

drop view if exists public.revenue_committed;
create view public.revenue_committed as
  -- Money committed but not yet collected: open invoices (sent, awaiting
  -- payment) plus accepted-but-pay-on-invoice flows.
  select
    currency,
    kind,
    count(*)         as invoice_count,
    sum(total_cents) as committed_cents
  from public.invoices
  where status = 'open'
  group by 1, 2;

drop view if exists public.revenue_quotes_in_flight;
create view public.revenue_quotes_in_flight as
  -- Forward pipeline: total $ value of quotes the studio could still accept.
  select
    currency,
    count(*)         as quote_count,
    sum(total_cents) as pipeline_cents
  from public.quotes
  where status in ('sent','viewed')
    and (expires_at is null or expires_at > now())
  group by 1;

-- =============================================================================
-- 7. Defensive trigger: source-tag immutability
-- =============================================================================
-- Once a row's `source` is written, it can never change. Prevents accidental
-- (or malicious) relabelling of a StudioLAB Growth invoice as something
-- else, or vice versa. The webhook handler and admin-action guards both
-- depend on `source` being stable.
create or replace function public.invoices_source_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.source is distinct from new.source then
    raise exception 'invoices.source is immutable (was %, attempted %)', old.source, new.source;
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_source_immutable on public.invoices;
create trigger invoices_source_immutable
  before update on public.invoices
  for each row execute function public.invoices_source_immutable();

create or replace function public.quotes_source_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.source is distinct from new.source then
    raise exception 'quotes.source is immutable (was %, attempted %)', old.source, new.source;
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_source_immutable on public.quotes;
create trigger quotes_source_immutable
  before update on public.quotes
  for each row execute function public.quotes_source_immutable();
