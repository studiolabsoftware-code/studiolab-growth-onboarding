-- 054_country_business_identifiers.sql
--
-- APPLY BY HAND. `supabase migration list --linked` reports Remote as EMPTY for
-- every migration in this repo, so `supabase db push` would replay all 54
-- against a live schema. Run this file's statements directly.
--
-- WHY. Migration 040 gave the submissions table exactly three business
-- identifier columns - ein, abn, acn - because the form asked for exactly three
-- things, gated on the two commercial lines (Australia, and everyone else).
-- Country is a SEPARATE axis from the commercial line: a UK studio pays on the
-- everyone-else line in USD AND is a UK business holding a Companies House
-- number and no EIN. So every studio outside AU and the US was asked for no
-- business identifier at all, and Standard A2P brand registration wants the one
-- their country issues. They would have reached SMS registration with nothing
-- to submit, and nothing in the flow would have surfaced it until it failed.
--
-- The catalogue that decides which of these a studio is asked for lives in
-- supabase/functions/_shared/business-identifiers.ts. Adding a country there
-- with an identifier not in this list needs a migration; reusing one does not.

alter table public.submissions
  add column if not exists nzbn    text,
  add column if not exists crn     text,
  add column if not exists bn      text,
  add column if not exists tax_id  text;

comment on column public.submissions.nzbn is
  'New Zealand Business Number (13 digits). Every NZ business can hold one, including sole traders.';

comment on column public.submissions.crn is
  'UK Companies House company registration number (8 characters). Companies and LLPs only; a UK sole trader has none.';

comment on column public.submissions.bn is
  'Canadian CRA Business Number (9 digits).';

comment on column public.submissions.tax_id is
  'Generic business registration or tax number, for a country we hold no specific catalogue entry for. Free text by nature: the shape varies by country and we do not validate it. Mask on admin display, the same as ein - we cannot know whether a given country''s number is a public registry ID or a sensitive tax ID.';
