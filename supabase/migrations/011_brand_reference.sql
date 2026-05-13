-- Optional brand-colours reference image. Lets studios that don't know
-- their hex codes drop a screenshot for the team to match colours from.
-- Stored in the existing logos bucket; anon insert policy already covers it.

alter table public.submissions
  add column if not exists brand_reference_url text;
