-- =============================================================================
-- Upgrade products catalog
-- =============================================================================
-- Studios occasionally change plan tier and/or setup method after their initial
-- onboarding. The pricing reference defines 12 distinct upgrade paths across
-- three categories:
--
--   plan_upgrade     - same setup method, higher plan tier
--                      (Launch->Scale, Launch->AI, Scale->AI; once Guided->Guided
--                      and once DFY->DFY for each)
--   setup_conversion - same plan, Guided -> DFY  (retroactive build by the team)
--   combined_upgrade - both plan tier AND setup method jump in one engagement
--
-- These don't fit the existing `products` table because that table is keyed on
-- (plan, setup_type, currency) for the initial setup fee. Upgrades need from/to
-- pairs, so they live in their own sibling table.
--
-- Each path has an AUD row and a USD row, giving 24 SKUs total. Australian
-- studios are billed AUD ex-GST in the database; GST is added at invoice time
-- (matches the existing create-custom-invoice + create-quote behaviour). USD
-- prices are tax-exclusive (no GST applies overseas).
--
-- Rows are immutable in schema but prices are editable through the admin
-- Catalog UI (manage-products-style update flow). Adding a new path means
-- inserting two rows (AUD + USD).
-- =============================================================================

create table if not exists public.upgrade_products (
  id                 uuid primary key default gen_random_uuid(),
  category           text not null check (category in ('plan_upgrade','setup_conversion','combined_upgrade')),
  from_plan          text not null check (from_plan in ('launch','scale','ai')),
  to_plan            text not null check (to_plan   in ('launch','scale','ai')),
  from_setup         text not null check (from_setup in ('dfy','guided')),
  to_setup           text not null check (to_setup   in ('dfy','guided')),
  currency           text not null check (currency in ('AUD','USD')),
  amount_cents       integer not null check (amount_cents >= 0),
  tax_code           text not null default 'txcd_10000000',
  name               text not null,
  description        text not null,
  includes           jsonb not null default '[]'::jsonb,
  stripe_product_id  text,
  active             boolean not null default true,
  sort_order         integer not null default 100,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.admin_users(id),
  constraint upgrade_products_unique_path unique (from_plan, to_plan, from_setup, to_setup, currency)
);

comment on table public.upgrade_products is
  'Catalog of one-time upgrade fees: plan tier moves, setup method conversions, '
  'and combined moves. One row per (from_plan, to_plan, from_setup, to_setup, currency). '
  'Sibling to public.products, which only covers initial setup fees.';

comment on column public.upgrade_products.category is
  'plan_upgrade: same setup. setup_conversion: same plan. combined_upgrade: both move at once.';
comment on column public.upgrade_products.amount_cents is
  'Tax-exclusive for AUD (GST added at invoice time). Tax-not-applicable for USD.';
comment on column public.upgrade_products.includes is
  'JSON array of strings rendered as the inclusion bullet list on quotes/invoices.';

create index if not exists upgrade_products_category_idx on public.upgrade_products (category) where active;
create index if not exists upgrade_products_currency_idx on public.upgrade_products (currency) where active;

drop trigger if exists upgrade_products_set_updated_at on public.upgrade_products;
create trigger upgrade_products_set_updated_at
  before update on public.upgrade_products
  for each row execute function public.set_updated_at();

alter table public.upgrade_products enable row level security;

drop policy if exists upgrade_products_select_authenticated on public.upgrade_products;
create policy upgrade_products_select_authenticated on public.upgrade_products
  for select to authenticated using (true);

drop policy if exists upgrade_products_modify_owner_admin on public.upgrade_products;
create policy upgrade_products_modify_owner_admin on public.upgrade_products
  for all to authenticated
  using (exists (select 1 from public.admin_users au where au.id = auth.uid() and au.role in ('owner','admin') and au.is_active))
  with check (exists (select 1 from public.admin_users au where au.id = auth.uid() and au.role in ('owner','admin') and au.is_active));

-- =============================================================================
-- Seed the 24 SKUs from the May 2026 Master Pricing Reference v2
-- =============================================================================
-- Inclusion bullets and scope language come straight from the reference so
-- studios see the same wording on the invoice as the team uses internally.
-- ON CONFLICT keeps the migration idempotent and preserves any subsequent
-- price edits made through the admin Catalog.

insert into public.upgrade_products
  (category, from_plan, to_plan, from_setup, to_setup, currency, amount_cents, name, description, includes, sort_order)
values
  -- ── 3.1 PLAN UPGRADE (same setup) ─────────────────────────────────────────
  ('plan_upgrade', 'launch', 'scale', 'guided', 'guided', 'AUD', 14900,
    'Launch → Scale (Guided)',
    'Feature unlock and SMS configuration. Updated checklist sent to studio.',
    '["Scale features unlocked","SMS configuration enabled","Updated setup checklist provided"]'::jsonb, 110),

  ('plan_upgrade', 'launch', 'scale', 'guided', 'guided', 'USD', 11900,
    'Launch → Scale (Guided)',
    'Feature unlock and SMS configuration. Updated checklist sent to studio.',
    '["Scale features unlocked","SMS configuration enabled","Updated setup checklist provided"]'::jsonb, 110),

  ('plan_upgrade', 'launch', 'scale', 'dfy', 'dfy', 'AUD', 29900,
    'Launch → Scale (Done-For-You)',
    'Feature unlock plus SMS and social channel configuration by the team.',
    '["Scale features unlocked","SMS sender configured by team","Social channels connected","Facebook and Google lead ad integration"]'::jsonb, 120),

  ('plan_upgrade', 'launch', 'scale', 'dfy', 'dfy', 'USD', 22900,
    'Launch → Scale (Done-For-You)',
    'Feature unlock plus SMS and social channel configuration by the team.',
    '["Scale features unlocked","SMS sender configured by team","Social channels connected","Facebook and Google lead ad integration"]'::jsonb, 120),

  ('plan_upgrade', 'launch', 'ai', 'guided', 'guided', 'AUD', 44900,
    'Launch → Dominate AI (Guided)',
    'Knowledge base build, AI chat configuration, voice agent setup and testing. Scale features also unlocked.',
    '["Scale and Dominate AI features unlocked","Knowledge base built from studio content","AI chat assistant configured and tested","AI voice agent set up and tested","Studio walkthrough on completion"]'::jsonb, 130),

  ('plan_upgrade', 'launch', 'ai', 'guided', 'guided', 'USD', 34900,
    'Launch → Dominate AI (Guided)',
    'Knowledge base build, AI chat configuration, voice agent setup and testing. Scale features also unlocked.',
    '["Scale and Dominate AI features unlocked","Knowledge base built from studio content","AI chat assistant configured and tested","AI voice agent set up and tested","Studio walkthrough on completion"]'::jsonb, 130),

  ('plan_upgrade', 'launch', 'ai', 'dfy', 'dfy', 'AUD', 44900,
    'Launch → Dominate AI (Done-For-You)',
    'AI layer added to existing DFY configuration. Knowledge base, AI chat, voice agent.',
    '["Scale and Dominate AI features unlocked","Knowledge base built from studio content","AI chat assistant configured and tested","AI voice agent set up and tested","Studio walkthrough on completion"]'::jsonb, 140),

  ('plan_upgrade', 'launch', 'ai', 'dfy', 'dfy', 'USD', 34900,
    'Launch → Dominate AI (Done-For-You)',
    'AI layer added to existing DFY configuration. Knowledge base, AI chat, voice agent.',
    '["Scale and Dominate AI features unlocked","Knowledge base built from studio content","AI chat assistant configured and tested","AI voice agent set up and tested","Studio walkthrough on completion"]'::jsonb, 140),

  ('plan_upgrade', 'scale', 'ai', 'guided', 'guided', 'AUD', 44900,
    'Scale → Dominate AI (Guided)',
    'Knowledge base build, AI chat configuration, voice agent setup and testing.',
    '["Dominate AI features unlocked","Knowledge base built from studio content","AI chat assistant configured and tested","AI voice agent set up and tested","Studio walkthrough on completion"]'::jsonb, 150),

  ('plan_upgrade', 'scale', 'ai', 'guided', 'guided', 'USD', 34900,
    'Scale → Dominate AI (Guided)',
    'Knowledge base build, AI chat configuration, voice agent setup and testing.',
    '["Dominate AI features unlocked","Knowledge base built from studio content","AI chat assistant configured and tested","AI voice agent set up and tested","Studio walkthrough on completion"]'::jsonb, 150),

  ('plan_upgrade', 'scale', 'ai', 'dfy', 'dfy', 'AUD', 44900,
    'Scale → Dominate AI (Done-For-You)',
    'AI layer added to existing DFY Scale configuration.',
    '["Dominate AI features unlocked","Knowledge base built from studio content","AI chat assistant configured and tested","AI voice agent set up and tested","Studio walkthrough on completion"]'::jsonb, 160),

  ('plan_upgrade', 'scale', 'ai', 'dfy', 'dfy', 'USD', 34900,
    'Scale → Dominate AI (Done-For-You)',
    'AI layer added to existing DFY Scale configuration.',
    '["Dominate AI features unlocked","Knowledge base built from studio content","AI chat assistant configured and tested","AI voice agent set up and tested","Studio walkthrough on completion"]'::jsonb, 160),

  -- ── 3.2 SETUP CONVERSION (same plan, Guided → DFY) ────────────────────────
  ('setup_conversion', 'launch', 'launch', 'guided', 'dfy', 'AUD', 34900,
    'Launch — Guided → Done-For-You',
    'Retroactive DFY configuration of existing Launch account. Team audits and rebuilds.',
    '["Full account audit","CRM and pipelines reconfigured","Lead capture and chat widget optimised","Sequences rebuilt to DFY standard","Handover summary provided"]'::jsonb, 210),

  ('setup_conversion', 'launch', 'launch', 'guided', 'dfy', 'USD', 26900,
    'Launch — Guided → Done-For-You',
    'Retroactive DFY configuration of existing Launch account. Team audits and rebuilds.',
    '["Full account audit","CRM and pipelines reconfigured","Lead capture and chat widget optimised","Sequences rebuilt to DFY standard","Handover summary provided"]'::jsonb, 210),

  ('setup_conversion', 'scale', 'scale', 'guided', 'dfy', 'AUD', 39900,
    'Scale — Guided → Done-For-You',
    'Retroactive DFY on Scale account including SMS and social channel configuration.',
    '["Full account audit","All Scale features configured","SMS sender and campaigns set up","Social Planner and lead ad integration","Handover summary provided"]'::jsonb, 220),

  ('setup_conversion', 'scale', 'scale', 'guided', 'dfy', 'USD', 30900,
    'Scale — Guided → Done-For-You',
    'Retroactive DFY on Scale account including SMS and social channel configuration.',
    '["Full account audit","All Scale features configured","SMS sender and campaigns set up","Social Planner and lead ad integration","Handover summary provided"]'::jsonb, 220),

  ('setup_conversion', 'ai', 'ai', 'guided', 'dfy', 'AUD', 69900,
    'Dominate AI — Guided → Done-For-You',
    'Retroactive DFY on Dominate AI account. Knowledge base build and full AI configuration.',
    '["Full account audit","Knowledge base built from studio content","AI chat configured and tested","AI voice agent set up and tested","All sequences rebuilt to DFY standard","Studio walkthrough on completion"]'::jsonb, 230),

  ('setup_conversion', 'ai', 'ai', 'guided', 'dfy', 'USD', 54900,
    'Dominate AI — Guided → Done-For-You',
    'Retroactive DFY on Dominate AI account. Knowledge base build and full AI configuration.',
    '["Full account audit","Knowledge base built from studio content","AI chat configured and tested","AI voice agent set up and tested","All sequences rebuilt to DFY standard","Studio walkthrough on completion"]'::jsonb, 230),

  -- ── 3.3 COMBINED PLAN + SETUP UPGRADE ─────────────────────────────────────
  ('combined_upgrade', 'launch', 'scale', 'guided', 'dfy', 'AUD', 49900,
    'Launch → Scale + Done-For-You',
    'Plan upgrade plus full DFY configuration of Scale features in one engagement.',
    '["Scale features unlocked","Full DFY configuration of all Scale features","SMS and social channels configured","Sequences and pipelines built","Handover summary provided"]'::jsonb, 310),

  ('combined_upgrade', 'launch', 'scale', 'guided', 'dfy', 'USD', 38900,
    'Launch → Scale + Done-For-You',
    'Plan upgrade plus full DFY configuration of Scale features in one engagement.',
    '["Scale features unlocked","Full DFY configuration of all Scale features","SMS and social channels configured","Sequences and pipelines built","Handover summary provided"]'::jsonb, 310),

  ('combined_upgrade', 'launch', 'ai', 'guided', 'dfy', 'AUD', 74900,
    'Launch → Dominate AI + Done-For-You',
    'Plan upgrade to Dominate AI plus full DFY including knowledge base and AI configuration. Scale also unlocked.',
    '["Scale and Dominate AI features unlocked","Full DFY configuration of all features","Knowledge base built from studio content","AI chat and voice agent configured and tested","Studio walkthrough on completion"]'::jsonb, 320),

  ('combined_upgrade', 'launch', 'ai', 'guided', 'dfy', 'USD', 57900,
    'Launch → Dominate AI + Done-For-You',
    'Plan upgrade to Dominate AI plus full DFY including knowledge base and AI configuration. Scale also unlocked.',
    '["Scale and Dominate AI features unlocked","Full DFY configuration of all features","Knowledge base built from studio content","AI chat and voice agent configured and tested","Studio walkthrough on completion"]'::jsonb, 320),

  ('combined_upgrade', 'scale', 'ai', 'guided', 'dfy', 'AUD', 69900,
    'Scale → Dominate AI + Done-For-You',
    'Plan upgrade to Dominate AI plus full DFY including knowledge base and AI configuration.',
    '["Dominate AI features unlocked","Full DFY AI configuration","Knowledge base built from studio content","AI chat and voice agent configured and tested","Studio walkthrough on completion"]'::jsonb, 330),

  ('combined_upgrade', 'scale', 'ai', 'guided', 'dfy', 'USD', 54900,
    'Scale → Dominate AI + Done-For-You',
    'Plan upgrade to Dominate AI plus full DFY including knowledge base and AI configuration.',
    '["Dominate AI features unlocked","Full DFY AI configuration","Knowledge base built from studio content","AI chat and voice agent configured and tested","Studio walkthrough on completion"]'::jsonb, 330)

on conflict (from_plan, to_plan, from_setup, to_setup, currency) do nothing;
