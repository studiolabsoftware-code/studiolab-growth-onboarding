-- 048: stamp the StudioLAB Growth sub-account id on a submission.
--
-- WHY. A studio arriving from a C1 invite link carries a pre-bind token that resolves, server-side
-- only, to their signup row in growth_manager.inbound_signup. location_id is the canonical binding
-- key that ties this submission back to that signup, and onward to the studio spine. Stamping it at
-- verify-otp time kills the match-at-Connect seam, where a human had to guess which submission
-- belonged to which sub-account by comparing names and email addresses.
--
-- SERVER-STAMPED ONLY. Nothing client-supplied ever writes this column: a browser-supplied
-- location_id is trivially forgeable, and a forged one would attach a submission to somebody else's
-- sub-account. verify-otp and save-draft derive it from the token via the SECURITY DEFINER RPC
-- growth_manager.resolve_signup_by_token and write it themselves.
--
-- (An earlier draft of this comment said a forged value "would corrupt the binding that
-- promote_verified_capture() depends on". That is wrong and worth correcting rather than deleting:
-- promote_verified_capture reads capture_intake -> inbound_signup -> studio and never touches
-- public.submissions, and it is not applied to the live database at all. The real justification is
-- the seam above.)
--
-- ADDITIVE and idempotent. No existing column changes type, nothing is dropped, and the column is
-- nullable because every submission created before this migration, and every studio who reaches the
-- form without an invite link, legitimately has no sub-account id. Safe to re-run.
--
-- Contract note: the Connector reads submissions through a column allow-list
-- (growth_manager.read_submission_safe / list_submissions_safe). Adding a column does not widen that
-- allow-list, so this stays contract-safe until someone deliberately adds it there.

alter table public.submissions
  add column if not exists location_id text;

comment on column public.submissions.location_id is
  'StudioLAB Growth sub-account id, stamped SERVER-SIDE at verify-otp from the pre-bind token. Never client-supplied.';

-- Partial index: only a minority of rows carry a location_id, and every lookup that matters asks
-- "which submission belongs to this sub-account".
create index if not exists submissions_location_id_idx
  on public.submissions (location_id)
  where location_id is not null;

-- Keep the lower-case invariant honest. Every write path lower-cases the address, and the sign-in
-- lookups switched from ilike to eq on 2026-08-20 on exactly that basis - but nothing ENFORCED it,
-- so one insert path that skipped normalisation would lock a studio out of their own draft. Verified
-- before adding: zero mixed-case rows in either table, so both constraints validate immediately.
do $$ begin
  alter table public.submissions
    add constraint submissions_contact_email_lower
    check (contact_email is null or contact_email = lower(contact_email));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.studio_otps
    add constraint studio_otps_email_lower
    check (email = lower(email));
exception when duplicate_object then null;
end $$;
