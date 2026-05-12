-- Phase 1 of the Stripe build: a singleton settings row that the admin
-- Settings page reads and writes. Stripe secret keys never live here — they
-- are kept in Supabase Edge Function secrets (STRIPE_SECRET_KEY_TEST/LIVE,
-- STRIPE_WEBHOOK_SECRET_TEST/LIVE) so the frontend can never see them. This
-- table only holds the mode switch, the public publishable keys, and the
-- global defaults that ship later in the build.

create table if not exists public.payment_settings (
  id                          smallint primary key default 1,
  stripe_mode                 text not null default 'test'
                                check (stripe_mode in ('test','live')),
  stripe_publishable_key_test text,
  stripe_publishable_key_live text,
  default_payment_mode        text not null default 'immediate'
                                check (default_payment_mode in ('immediate','hold','save_card')),
  auto_capture_stage          text not null default 'setup_in_progress',
  last_connection_test_at     timestamptz,
  last_connection_test_ok     boolean,
  last_connection_test_detail jsonb,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.admin_users(id),
  constraint payment_settings_singleton check (id = 1)
);

-- Seed the singleton row so the admin page always has something to read.
insert into public.payment_settings (id) values (1)
on conflict (id) do nothing;

-- updated_at trigger reuses the helper from migration 001.
drop trigger if exists payment_settings_set_updated_at on public.payment_settings;
create trigger payment_settings_set_updated_at
  before update on public.payment_settings
  for each row execute function public.set_updated_at();

alter table public.payment_settings enable row level security;

-- All authenticated admins can read the settings (mode + publishable keys are
-- not sensitive; the publishable key is meant to be exposed to the frontend).
-- Writes happen exclusively via the save-payment-settings Edge Function with
-- the service-role key after an owner check, so no UPDATE policy is granted.
drop policy if exists payment_settings_select_admin on public.payment_settings;
create policy payment_settings_select_admin on public.payment_settings
  for select to authenticated using (true);
