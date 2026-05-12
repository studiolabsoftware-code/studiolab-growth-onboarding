-- Step 6 of the onboarding form became informational only. Season data is
-- pulled directly from StudioLAB during setup, and all plan automations are
-- on by default — so the form no longer collects either.

alter table public.submissions
  drop column if exists season_active,
  drop column if exists season_name,
  drop column if exists enrol_open_date,
  drop column if exists billing_start,
  drop column if exists season_end,
  drop column if exists active_workflows;
