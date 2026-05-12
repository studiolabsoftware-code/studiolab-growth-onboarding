-- Phase 2 of the Stripe build: the full schema for the billing system. Adds
-- payment columns to submissions, creates the catalog tables (products,
-- product_price_history, discount_codes), the per-submission price snapshot
-- (submission_pricing), and the webhook idempotency table (stripe_events).
-- All amounts are stored as integer cents — no floating-point money.

-- =============================================================================
-- 1. submissions: billing columns
-- =============================================================================
alter table public.submissions
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in (
      'unpaid','pending','authorised','card_saved','paid',
      'auth_expired','charge_failed','refunded'
    )),
  add column if not exists payment_mode text
    check (payment_mode in ('immediate','hold','save_card')),
  add column if not exists stripe_customer_id        text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id   text,
  add column if not exists stripe_invoice_id          text,
  add column if not exists invoice_hosted_url         text,
  add column if not exists invoice_pdf_url            text,
  add column if not exists amount_paid_cents          integer,
  add column if not exists currency                   text
    check (currency is null or currency in ('AUD','USD')),
  add column if not exists tax_amount_cents           integer,
  add column if not exists authorization_expires_at   timestamptz,
  add column if not exists captured_at                timestamptz,
  add column if not exists paid_at                    timestamptz,
  add column if not exists payment_method_id          text,
  add column if not exists card_saved_at              timestamptz,
  add column if not exists charge_scheduled_for       date,
  add column if not exists last_charge_attempt_at     timestamptz,
  add column if not exists charge_failure_reason      text;

create index if not exists submissions_payment_status_idx
  on public.submissions (payment_status);
create index if not exists submissions_charge_scheduled_idx
  on public.submissions (charge_scheduled_for)
  where charge_scheduled_for is not null;
create index if not exists submissions_card_saved_at_idx
  on public.submissions (card_saved_at)
  where card_saved_at is not null;
create index if not exists submissions_auth_expires_idx
  on public.submissions (authorization_expires_at)
  where authorization_expires_at is not null;

-- =============================================================================
-- 2. activity_log: new action types
-- =============================================================================
-- Replace the action CHECK so the existing webhook + admin actions log cleanly.
alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check
  check (action in (
    -- existing
    'submitted','viewed','status_changed','change_request_sent',
    'change_request_completed','note_added','assigned','plan_changed',
    -- billing
    'payment_started','payment_authorised','payment_captured',
    'payment_card_saved','payment_failed','payment_refunded',
    'payment_mode_changed','payment_pricing_changed','payment_session_expired'
  ));

-- =============================================================================
-- 3. stripe_events — webhook idempotency
-- =============================================================================
create table if not exists public.stripe_events (
  event_id     text primary key,
  type         text not null,
  received_at  timestamptz not null default now(),
  livemode     boolean,
  payload      jsonb not null
);

create index if not exists stripe_events_received_idx
  on public.stripe_events (received_at desc);

alter table public.stripe_events enable row level security;

-- Authenticated admins can read events for debugging. Writes are exclusively
-- via the stripe-webhook Edge Function with the service-role key.
drop policy if exists stripe_events_select_admin on public.stripe_events;
create policy stripe_events_select_admin on public.stripe_events
  for select to authenticated using (true);

-- =============================================================================
-- 4. products — Supabase-owned catalog (one row per plan × setup × currency)
-- =============================================================================
create table if not exists public.products (
  id                 uuid primary key default gen_random_uuid(),
  plan               text not null check (plan in ('launch','scale','ai')),
  setup_type         text not null check (setup_type in ('dfy','guided')),
  currency           text not null check (currency in ('AUD','USD')),
  stripe_product_id  text,
  name               text not null,
  description        text,
  amount_cents       integer not null default 0 check (amount_cents >= 0),
  tax_code           text not null default 'txcd_10000000',
  active             boolean not null default false,
  effective_from     timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.admin_users(id),
  constraint products_unique_combo unique (plan, setup_type, currency)
);

create index if not exists products_active_idx on public.products (active) where active;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

alter table public.products enable row level security;

drop policy if exists products_select_admin on public.products;
create policy products_select_admin on public.products
  for select to authenticated using (true);

-- Seed the six catalog rows with placeholder amounts and active = false so
-- the admin product catalog page (phase 3) renders a populated matrix. Real
-- amounts are entered in the UI and recorded with reason + audit trail.
insert into public.products (plan, setup_type, currency, name, description, amount_cents, active)
values
  ('launch', 'dfy',    'AUD', 'Launch — Done for you',        'Launch plan one-off setup, done for you by the StudioLAB team.', 0, false),
  ('launch', 'dfy',    'USD', 'Launch — Done for you',        'Launch plan one-off setup, done for you by the StudioLAB team.', 0, false),
  ('launch', 'guided', 'AUD', 'Launch — Guided setup',        'Launch plan one-off setup, guided by the StudioLAB team.',       0, false),
  ('launch', 'guided', 'USD', 'Launch — Guided setup',        'Launch plan one-off setup, guided by the StudioLAB team.',       0, false),
  ('scale',  'dfy',    'AUD', 'Scale — Done for you',         'Scale plan one-off setup, done for you by the StudioLAB team.',  0, false),
  ('scale',  'dfy',    'USD', 'Scale — Done for you',         'Scale plan one-off setup, done for you by the StudioLAB team.',  0, false),
  ('scale',  'guided', 'AUD', 'Scale — Guided setup',         'Scale plan one-off setup, guided by the StudioLAB team.',        0, false),
  ('scale',  'guided', 'USD', 'Scale — Guided setup',         'Scale plan one-off setup, guided by the StudioLAB team.',        0, false),
  ('ai',     'dfy',    'AUD', 'Dominate AI — Done for you',   'Dominate AI plan one-off setup, done for you by the StudioLAB team.', 0, false),
  ('ai',     'dfy',    'USD', 'Dominate AI — Done for you',   'Dominate AI plan one-off setup, done for you by the StudioLAB team.', 0, false),
  ('ai',     'guided', 'AUD', 'Dominate AI — Guided setup',   'Dominate AI plan one-off setup, guided by the StudioLAB team.',       0, false),
  ('ai',     'guided', 'USD', 'Dominate AI — Guided setup',   'Dominate AI plan one-off setup, guided by the StudioLAB team.',       0, false)
on conflict (plan, setup_type, currency) do nothing;

-- =============================================================================
-- 5. product_price_history — append-only audit log of every price change
-- =============================================================================
create table if not exists public.product_price_history (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references public.products(id) on delete cascade,
  amount_cents          integer not null check (amount_cents >= 0),
  previous_amount_cents integer,
  reason                text,
  changed_at            timestamptz not null default now(),
  changed_by            uuid references public.admin_users(id)
);

create index if not exists product_price_history_product_idx
  on public.product_price_history (product_id, changed_at desc);

alter table public.product_price_history enable row level security;

drop policy if exists product_price_history_select_admin on public.product_price_history;
create policy product_price_history_select_admin on public.product_price_history
  for select to authenticated using (true);

-- =============================================================================
-- 6. discount_codes
-- =============================================================================
create table if not exists public.discount_codes (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null,
  kind                    text not null check (kind in ('percentage','fixed_amount')),
  value                   integer not null check (value > 0),
  applies_to_all          boolean not null default true,
  applies_to_product_ids  uuid[] not null default '{}',
  currency                text check (currency is null or currency in ('AUD','USD')),
  valid_from              timestamptz,
  valid_until             timestamptz,
  max_redemptions         integer check (max_redemptions is null or max_redemptions > 0),
  redemption_count        integer not null default 0 check (redemption_count >= 0),
  active                  boolean not null default true,
  created_at              timestamptz not null default now(),
  created_by              uuid references public.admin_users(id),
  -- Percentage codes use value as 1..100; fixed_amount uses value as cents.
  constraint discount_codes_value_range
    check ((kind = 'percentage' and value between 1 and 100)
        or (kind = 'fixed_amount' and value >= 1)),
  -- fixed_amount codes must declare which currency they are denominated in.
  constraint discount_codes_currency_required
    check ((kind = 'percentage' and currency is null)
        or (kind = 'fixed_amount' and currency is not null))
);

-- Case-insensitive uniqueness on code.
create unique index if not exists discount_codes_code_unique
  on public.discount_codes (lower(code));

create index if not exists discount_codes_active_idx
  on public.discount_codes (active) where active;

alter table public.discount_codes enable row level security;

drop policy if exists discount_codes_select_admin on public.discount_codes;
create policy discount_codes_select_admin on public.discount_codes
  for select to authenticated using (true);

-- =============================================================================
-- 7. submission_pricing — per-submission price snapshot at checkout creation
-- =============================================================================
-- One row per submission. Populated at checkout-session creation and never
-- mutated after a successful payment lands — this is the immutable record of
-- "what we quoted, what we charged, why." Compliance and audit depend on it.
create table if not exists public.submission_pricing (
  submission_id          uuid primary key
                           references public.submissions(id) on delete cascade,
  product_id             uuid not null references public.products(id),
  list_amount_cents      integer not null check (list_amount_cents >= 0),
  discount_code_id       uuid references public.discount_codes(id),
  discount_amount_cents  integer check (discount_amount_cents is null or discount_amount_cents >= 0),
  override_amount_cents  integer check (override_amount_cents is null or override_amount_cents >= 0),
  override_reason        text,
  final_amount_cents     integer not null check (final_amount_cents >= 0),
  currency               text not null check (currency in ('AUD','USD')),
  snapshotted_at         timestamptz not null default now(),
  snapshotted_by         uuid references public.admin_users(id),
  -- If an override is set, its reason must be provided.
  constraint submission_pricing_override_reason_required
    check (override_amount_cents is null or override_reason is not null)
);

create index if not exists submission_pricing_product_idx
  on public.submission_pricing (product_id);
create index if not exists submission_pricing_discount_idx
  on public.submission_pricing (discount_code_id)
  where discount_code_id is not null;

alter table public.submission_pricing enable row level security;

drop policy if exists submission_pricing_select_admin on public.submission_pricing;
create policy submission_pricing_select_admin on public.submission_pricing
  for select to authenticated using (true);
