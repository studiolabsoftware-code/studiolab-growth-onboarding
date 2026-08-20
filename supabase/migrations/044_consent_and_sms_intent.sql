-- 044_consent_and_sms_intent.sql
-- Onboarding form refinement (pre-go-live). See
-- outputs/onboarding-form-refinement-plan.md and the growth-connector spec
-- docs/plans/old-form-refinement-spec.md (sections 3, 4).
--
-- Purely ADDITIVE (all columns nullable). The Growth Connector reads
-- public.submissions by an explicit column allow-list, so adding columns is
-- contract-safe; no existing column is renamed or dropped here.
--
-- Two changes ship together:
--
-- 1. sms_setup_requested — the collapsed SMS capture. The old form asked for
--    a number preference plus Twilio/porting details; we now ask a single
--    yes/no "do you want us to set up text messaging for you", and handle the
--    number purchase and carrier (A2P/10DLC/ABN) registration during
--    onboarding. The retired sms_type / area_code / has_twilio /
--    twilio_number / port_number columns are LEFT IN PLACE (older rows keep
--    their values); the form simply stops writing them. sms_tone is retained
--    and still written.
--
-- 2. Send-on-behalf consent — the studio's explicit authorisation for us to
--    send email and SMS to their families on their behalf. Captured at the
--    review step and required to submit. Stored as a boolean plus an audit
--    trail: when it was captured and which wording version was in force, so a
--    later wording change is distinguishable in the record.

alter table public.submissions
  add column if not exists sms_setup_requested    boolean,
  add column if not exists consent_send_on_behalf boolean,
  add column if not exists consent_captured_at    timestamptz,
  add column if not exists consent_version        text;

comment on column public.submissions.sms_setup_requested is
  'Collapsed SMS intent (Scale/AI). True = studio asked us to set up text messaging; we purchase the number and handle carrier registration during onboarding. Supersedes the retired sms_type/area_code/has_twilio/twilio_number/port_number capture, which the form no longer writes. Null for Launch (no SMS) and for older rows.';

comment on column public.submissions.consent_send_on_behalf is
  'Explicit send-on-behalf consent captured at the review step. Required to submit; a submitted row should have this true. Null for drafts that never reached the consent step.';

comment on column public.submissions.consent_captured_at is
  'Timestamp the send-on-behalf consent box was ticked (client-stamped at save-time). Null unless consent_send_on_behalf is true.';

comment on column public.submissions.consent_version is
  'Wording version of the consent text in force when consent was given (e.g. v1-2026-07-23). Lets a later wording change be told apart in the audit trail. Null unless consent_send_on_behalf is true.';
