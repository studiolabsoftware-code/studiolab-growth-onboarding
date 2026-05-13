-- Optional Twilio account connection. Studios with an existing Twilio
-- number can opt in here; we'll collect the SID and auth token via secure
-- method post-submit, the number itself is stored here for reference.

alter table public.submissions
  add column if not exists has_twilio boolean,
  add column if not exists twilio_number text;
