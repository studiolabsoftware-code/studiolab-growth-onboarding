-- Optional future-proof URLs collected on the Studio details step,
-- primarily for Launch studios so when they upgrade to Scale or Dominate AI
-- the lead-source and reputation automations can be turned on without a
-- follow-up data-collection round.

alter table public.submissions
  add column if not exists google_business_url text,
  add column if not exists facebook_url        text,
  add column if not exists instagram_handle    text,
  add column if not exists booking_url         text;
