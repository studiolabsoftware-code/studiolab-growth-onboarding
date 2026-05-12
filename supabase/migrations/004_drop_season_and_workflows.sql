-- StudioLAB Growth Onboarding: drop season + workflow columns
-- Run after 003_admin_allowlist_rpc.sql.
--
-- Season data is time-sensitive, lives in StudioLAB already, and will be
-- pulled directly during account configuration. Workflow toggles add friction
-- without value since every plan's automations are on by default and
-- configured by the StudioLAB team during setup.
--
-- The form's Step 5/6 is now a read-only 'Your automations' card with no
-- inputs. The admin detail view shows the same automations list keyed off
-- the submission's plan. These columns are no longer written by save-draft
-- (the ALLOWED_FIELDS whitelist already omits them).

alter table public.submissions drop column if exists season_active;
alter table public.submissions drop column if exists season_name;
alter table public.submissions drop column if exists enrol_open_date;
alter table public.submissions drop column if exists billing_start;
alter table public.submissions drop column if exists season_end;
alter table public.submissions drop column if exists active_workflows;
