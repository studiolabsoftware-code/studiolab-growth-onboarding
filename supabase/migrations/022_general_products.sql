-- =============================================================================
-- General products catalog
-- =============================================================================
-- Third catalog table sitting alongside:
--   * public.products          - initial setup fees (plan x setup x currency)
--   * public.upgrade_products  - upgrade paths between plan / setup combos
--
-- This table is the catch-all for everything else the team needs to invoice
-- ad hoc: consulting hours, training sessions, custom builds, audits, paid
-- add-ons, support packs. Anything that isn't a setup fee or an upgrade.
--
-- The shape is intentionally loose:
--   * sku           - human-readable handle, useful for invoice descriptions
--   * category      - free-form bucket so the picker can group sensibly
--                     (consulting / training / addon / custom / other are
--                     suggested but not enforced)
--   * name + description + includes - all editable through the admin UI
--   * one row per currency, paired by sku
--
-- Like upgrade_products, AUD amounts are stored ex-GST and GST is added at
-- invoice time by create-custom-invoice / create-quote. USD is tax-exclusive.
-- =============================================================================

create table if not exists public.general_products (
  id                 uuid primary key default gen_random_uuid(),
  sku                text not null,
  category           text not null default 'other',
  currency           text not null check (currency in ('AUD','USD')),
  amount_cents       integer not null check (amount_cents >= 0),
  tax_code           text not null default 'txcd_10000000',
  name               text not null,
  description        text not null default '',
  includes           jsonb not null default '[]'::jsonb,
  stripe_product_id  text,
  active             boolean not null default true,
  sort_order         integer not null default 100,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.admin_users(id),
  constraint general_products_sku_currency_unique unique (sku, currency)
);

comment on table public.general_products is
  'Catalog of arbitrary invoice line-item templates: consulting, training, '
  'add-ons, custom services. One row per (sku, currency). For setup fees use '
  'public.products; for plan/setup upgrades use public.upgrade_products.';

comment on column public.general_products.sku is
  'Admin-editable handle. Doubles as a stable reference when the team talks '
  'about an item ("the strategy-call SKU") even if name/description change.';
comment on column public.general_products.category is
  'Free-form bucket used for grouping in the catalog picker. Suggested values: '
  'consulting, training, addon, custom, other.';
comment on column public.general_products.amount_cents is
  'Tax-exclusive for AUD (GST added at invoice time). Tax-not-applicable for USD.';
comment on column public.general_products.includes is
  'JSON array of strings rendered as the inclusion bullet list on quotes/invoices.';

create index if not exists general_products_active_idx on public.general_products (active) where active;
create index if not exists general_products_category_idx on public.general_products (category) where active;
create index if not exists general_products_currency_idx on public.general_products (currency) where active;

drop trigger if exists general_products_set_updated_at on public.general_products;
create trigger general_products_set_updated_at
  before update on public.general_products
  for each row execute function public.set_updated_at();

alter table public.general_products enable row level security;

drop policy if exists general_products_select_authenticated on public.general_products;
create policy general_products_select_authenticated on public.general_products
  for select to authenticated using (true);

drop policy if exists general_products_modify_owner_admin on public.general_products;
create policy general_products_modify_owner_admin on public.general_products
  for all to authenticated
  using (exists (select 1 from public.admin_users au where au.id = auth.uid() and au.role in ('owner','admin') and au.is_active))
  with check (exists (select 1 from public.admin_users au where au.id = auth.uid() and au.role in ('owner','admin') and au.is_active));

-- No seed data. The admin Catalog UI is the canonical add-product path so
-- product wording matches whatever marketing/finance decides at the time.
