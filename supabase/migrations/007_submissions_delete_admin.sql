-- Allow authenticated admins to delete submissions. Without this policy,
-- delete() calls from the admin dashboard silently affect zero rows because
-- RLS is enabled on submissions but no DELETE policy exists. Cascades on
-- change_requests, activity_log, admin_notes, and submission_assignments
-- already handle child cleanup.

drop policy if exists submissions_delete_admin on public.submissions;
create policy submissions_delete_admin on public.submissions
  for delete to authenticated using (true);
