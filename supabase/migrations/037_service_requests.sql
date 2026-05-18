-- Migration 037: service_requests table + quote backlink.
--
-- Studios raise structured change requests (plan upgrade, setup switch,
-- custom add-on, other) from account.html. Admin reviews each one
-- manually -- no auto-pricing -- and either declines or opens the
-- existing quote modal to send a priced quote. The lifecycle stays
-- linked via service_requests.quote_id <-> quotes.service_request_id,
-- so the studio's request status reflects the quote's progress without
-- a separate state machine.
--
-- Statuses:
--   open      -- studio submitted, admin hasn't actioned yet
--   quoted    -- admin sent a quote (quote_id set); awaiting acceptance
--   paid      -- linked quote's invoice was paid; awaiting admin apply
--   applied   -- admin manually flipped plan/setup_type; request closed
--   declined  -- admin declined (declined_reason set)
--   withdrawn -- studio withdrew before action

create table if not exists public.service_requests (
  id                uuid primary key default gen_random_uuid(),
  submission_id     uuid not null references public.submissions(id) on delete cascade,
  kind              text not null check (kind in ('plan_upgrade','setup_change','custom_addon','other')),
  -- Optional target columns -- populated only for the kinds that need
  -- a structured target. plan_upgrade -> target_plan, setup_change ->
  -- target_setup_type. Custom add-on and other use notes only.
  target_plan       text check (target_plan in ('launch','scale','ai')),
  target_setup_type text check (target_setup_type in ('dfy','guided')),
  notes             text not null check (char_length(notes) <= 2000),
  status            text not null default 'open'
                      check (status in ('open','quoted','paid','applied','declined','withdrawn')),
  -- Backlink to the quote admin issued for this request. Null until
  -- admin opens the quote modal and sends one. ON DELETE SET NULL so a
  -- voided quote doesn't kill the request row.
  quote_id          uuid references public.quotes(id) on delete set null,
  declined_reason   text,
  applied_at        timestamptz,
  applied_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists service_requests_submission_status_idx
  on public.service_requests (submission_id, status);

create index if not exists service_requests_quote_id_idx
  on public.service_requests (quote_id) where quote_id is not null;

alter table public.service_requests enable row level security;

-- Service-role only. Studio writes go through the studio-request edge
-- function (session_token gated); admin reads/writes go through the
-- service-role client. No anon policy needed.
drop policy if exists service_requests_all_admin on public.service_requests;
create policy service_requests_all_admin on public.service_requests
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Quote backlink. Set on create-quote when the admin opens the quote
-- modal from a request context. Lets the stripe-webhook quote-paid
-- branch flip the linked request to 'paid' without scanning text.
alter table public.quotes
  add column if not exists service_request_id uuid
    references public.service_requests(id) on delete set null;

create index if not exists quotes_service_request_id_idx
  on public.quotes (service_request_id) where service_request_id is not null;

-- updated_at trigger -- mirror the pattern used on submissions so admin
-- can sort by recency without trusting client-side timestamps.
create or replace function public.touch_service_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists service_requests_touch_updated_at on public.service_requests;
create trigger service_requests_touch_updated_at
  before update on public.service_requests
  for each row execute function public.touch_service_requests_updated_at();

INSERT INTO supabase_migrations.schema_migrations (version)
VALUES ('037_service_requests')
ON CONFLICT DO NOTHING;
