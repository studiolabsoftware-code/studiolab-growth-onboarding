-- 056: required mobile number at signup (Gary 9 Nov, D79). Account and support texts only, never marketing.
-- ADDITIVE. Applied by hand like every migration here, and BEFORE save-draft / studio-self-edit are deployed
-- (they write these columns). contact_phone itself already exists (001) and now holds E.164 for new rows.
alter table public.submissions
  add column if not exists contact_phone_consent_at     timestamptz,
  add column if not exists contact_phone_consent_source text;
comment on column public.submissions.contact_phone_consent_at is
  'When the studio was shown the account-and-support-texts notice beside contact_phone and saved the number.';
comment on column public.submissions.contact_phone_consent_source is
  'Which surface showed the notice: onboarding_form | account_page.';
