-- Lead source social handles collected on Scale and Dominate AI.
-- facebook_url, instagram_handle, google_business_url already exist
-- (migration 010 added them as future-proof fields on Launch). Adding
-- the two new ones here.

alter table public.submissions
  add column if not exists tiktok_handle text,
  add column if not exists youtube_url   text;
