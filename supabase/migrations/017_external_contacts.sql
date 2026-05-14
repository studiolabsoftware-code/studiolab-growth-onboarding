-- =============================================================================
-- External contacts (Phase A of external-invoice flow)
-- =============================================================================
-- One-off invoicing of recipients who are not paying onboarding studios.
-- The recipient pays via Stripe's hosted-invoice email; no portal sign-in,
-- no StudioLAB account, no auth on their side. This table gives finance a
-- clean list of every external counterparty, lets the admin re-invoice the
-- same person without re-entering their details, and (cheap forward-compat
-- hook for Phase B) lets a paid external contact later be converted into a
-- proper studio submission with no data migration.
--
-- See memory: project_external_invoicing_phases (Phase A / Phase B split).
-- =============================================================================

create table if not exists public.external_contacts (
  id                       uuid primary key default gen_random_uuid(),
  email                    text not null,
  name                     text,
  country                  text,                    -- ISO 3166-1 alpha-2 where known
  notes                    text,                    -- internal admin note
  stripe_customer_id       text,                    -- linked when first invoiced
  -- Running totals updated by the stripe-webhook handler so finance can sort
  -- the external-contacts list without summing from the invoices table on
  -- every page load.
  invoice_count            integer not null default 0 check (invoice_count >= 0),
  total_invoiced_cents     integer not null default 0 check (total_invoiced_cents >= 0),
  total_paid_cents         integer not null default 0 check (total_paid_cents >= 0),
  -- Multi-currency: an external contact may receive both AUD and USD
  -- invoices over time, so we don't pin a single currency on the contact.
  -- Use the invoices ledger for currency-specific breakdowns.
  last_invoiced_at         timestamptz,
  last_paid_at             timestamptz,
  created_by               uuid references public.admin_users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Case-insensitive unique email so re-invoicing the same person finds the
-- existing row. Two external contacts can not share an email — if a studio
-- and an external contact both arrive with the same email, the admin will
-- see a clear "this email is already attached to a studio" prompt at
-- invoice-create time and choose the studio path instead.
create unique index if not exists external_contacts_email_uq
  on public.external_contacts (lower(email));

create index if not exists external_contacts_stripe_customer_idx
  on public.external_contacts (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists external_contacts_created_at_idx
  on public.external_contacts (created_at desc);

drop trigger if exists external_contacts_set_updated_at on public.external_contacts;
create trigger external_contacts_set_updated_at
  before update on public.external_contacts
  for each row execute function public.set_updated_at();

alter table public.external_contacts enable row level security;

drop policy if exists external_contacts_select_admin on public.external_contacts;
create policy external_contacts_select_admin on public.external_contacts
  for select to authenticated using (true);

-- =============================================================================
-- Forward-compat hooks on existing tables
-- =============================================================================
-- These nullable FKs make Phase B ("convert a paid external contact into a
-- studio") cheap to ship later without a data migration. They cost one
-- column each today and unlock the conversion flow when demand justifies it.

alter table public.submissions
  add column if not exists external_contact_id uuid;

alter table public.submissions
  drop constraint if exists submissions_external_contact_fk;
alter table public.submissions
  add constraint submissions_external_contact_fk
  foreign key (external_contact_id) references public.external_contacts(id) on delete set null;

create index if not exists submissions_external_contact_idx
  on public.submissions (external_contact_id)
  where external_contact_id is not null;

alter table public.invoices
  add column if not exists external_contact_id uuid;

alter table public.invoices
  drop constraint if exists invoices_external_contact_fk;
alter table public.invoices
  add constraint invoices_external_contact_fk
  foreign key (external_contact_id) references public.external_contacts(id) on delete set null;

create index if not exists invoices_external_contact_idx
  on public.invoices (external_contact_id)
  where external_contact_id is not null;

-- An invoice must attach to at least one of: a submission, an external
-- contact, or neither only if it's still draft / unattached. Don't enforce
-- with a CHECK because draft invoices can legitimately have no recipient
-- yet; surface the rule at the application layer instead.

-- =============================================================================
-- activity_log: new actions for external-contact lifecycle
-- =============================================================================
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
    -- invoices + quotes (migration 016)
    'invoice_issued','invoice_paid','invoice_voided',
    'invoice_refunded','invoice_resent',
    'custom_invoice_sent',
    'quote_drafted','quote_sent','quote_viewed','quote_accepted',
    'quote_declined','quote_expired','quote_revised','quote_reminded',
    'quote_cancelled',
    -- new in 017: external contacts
    'external_contact_created','external_contact_invoiced','external_contact_paid'
  ));

-- =============================================================================
-- Revenue view: extend revenue_collected to slice by recipient_type
-- =============================================================================
-- Drop and recreate so the finance dashboard can split "studio revenue" from
-- "external revenue" without a second query.

drop view if exists public.revenue_collected;
create view public.revenue_collected as
  select
    date_trunc('month', paid_at)             as period_month,
    currency,
    kind,
    case
      when submission_id is not null         then 'studio'
      when external_contact_id is not null   then 'external'
      else 'unattached'
    end                                       as recipient_type,
    count(*)                                  as invoice_count,
    sum(total_cents)                          as gross_cents,
    sum(amount_refunded_cents)                as refunded_cents,
    sum(total_cents - amount_refunded_cents)  as net_cents
  from public.invoices
  where status in ('paid','partially_refunded','refunded')
    and paid_at is not null
  group by 1, 2, 3, 4;
