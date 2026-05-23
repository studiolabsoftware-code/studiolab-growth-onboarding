-- 040_business_details.sql
-- Phase 1 of the onboarding access & compliance plan.
-- See docs/onboarding-access-and-compliance-capture.md.
--
-- Adds canonical business identity fields used for:
--   - Invoicing and Stripe tax handling
--   - Email-footer compliance (CAN-SPAM / SPAM Act 2003)
--   - Downstream SMS A2P 10DLC / Toll-Free / ABN registration (Phase 2+)
--
-- Structured-address columns supplement (not replace) the existing single
-- `address` column. buildPayload still writes a denormalised one-line
-- `address` for backward compatibility so existing email templates and
-- admin views keep working unchanged.
--
-- Sensitive fields (ein, ssn_last4) are stored as plain text. Supabase
-- already encrypts at rest on disk (AES-256). Column-level pgp encryption
-- requires a key-management story (env-injected key in the edge function)
-- that is out of scope for Phase 1 and tracked as a Phase 2+ follow-up.
-- The admin UI masks these on display; do not log them.

alter table public.submissions
  add column if not exists legal_business_name                text,
  add column if not exists trading_name                       text,
  add column if not exists business_type                      text,
  add column if not exists ein                                text,
  add column if not exists ssn_last4                          text,
  add column if not exists abn                                text,
  add column if not exists acn                                text,
  add column if not exists business_email                     text,
  add column if not exists business_email_is_personal_domain  boolean,
  add column if not exists address_street                     text,
  add column if not exists address_city                       text,
  add column if not exists address_region                     text,
  add column if not exists address_postcode                   text;

-- Soft constraint: business_type values we render in the form. Stored as
-- text so future plan changes don't require a schema migration to add an
-- option. Anything outside this list is allowed but flagged in review.
comment on column public.submissions.business_type is
  'One of: sole_prop, llc, corp, partnership, nonprofit, pty_ltd, other_au, other. Free text accepted but expected values map to A2P/ABN registration paths.';

comment on column public.submissions.ein is
  'US Employer Identification Number (XX-XXXXXXX). Plain text; mask on admin display. Field-level encryption tracked as Phase 2+ follow-up.';

comment on column public.submissions.ssn_last4 is
  'Last 4 digits of owner SSN for US Sole Proprietor A2P brand registration. Plain text; mask on admin display. Never expose full SSN; never log.';

comment on column public.submissions.abn is
  'Australian Business Number (11 digits). Required for AU studios.';

comment on column public.submissions.acn is
  'Australian Company Number (9 digits). Required for AU Pty Ltd entities.';

comment on column public.submissions.business_email_is_personal_domain is
  'Computed at submit-time. True if business_email matches a personal-email domain (gmail/hotmail/outlook/yahoo/icloud). Drives admin filtering and downstream nudge to obtain a business-domain email before A2P registration.';

-- Backfill legal_business_name from the legacy legal_name column for any
-- existing draft or submitted rows, so the new field renders in the admin
-- view without manual cleanup. legal_name stays readable but the form no
-- longer writes to it.
update public.submissions
   set legal_business_name = legal_name
 where legal_business_name is null
   and legal_name is not null;
