-- 049: make the normalisation invariants that .eq() lookups now depend on actually enforced.
--
-- WHY. On 2026-08-20 the OTP path swapped .ilike() to .eq() to kill a LIKE-metacharacter injection,
-- and 048 added CHECK constraints for the two tables that change touched. On 2026-08-21 a sweep
-- found nine more .ilike() lookups and swapped those too: admin_users (four sites),
-- external_contacts (two), and the discount code on the PUBLIC checkout path.
--
-- Every one of those swaps rests on the same unenforced assumption: that what is STORED is already
-- normalised. It is, today - verified before the swap that admin_users, external_contacts and
-- auth.users hold zero rows failing these checks, and discount_codes is empty. But "true today" is
-- how the previous version of this assumption survived long enough to become a bug. .ilike() was
-- quietly papering over the fact that nothing enforced it; with .ilike() gone, one insert path that
-- skips normalisation would silently stop matching, and the symptom would be an admin unable to
-- sign in or a customer told their valid discount code was not recognised.
--
-- So the invariant becomes a constraint rather than a habit.
--
-- WHITESPACE AS WELL AS CASE (Codex adversarial review, 2026-08-21, refined on the second pass). A
-- first draft checked only `email = lower(email)`. That is not the invariant the code relies on:
-- every request path does `.trim().toLowerCase()`, so a stored 'gary@example.com ' is perfectly
-- lower-case, passes that check, and still fails to match. The obvious repair, `lower(btrim(email))`,
-- was also wrong: Postgres `btrim` strips SPACES by default, while JavaScript `.trim()` also strips
-- tabs and newlines, so a trailing tab would have slipped through both the constraint and the
-- lookup. The check below therefore forbids whitespace anywhere in the address, which an email can
-- never legitimately contain unquoted and which is strictly stronger than mirroring trim().
--
-- THE CODE ALLOW-LIST, DECLINED THEN REVERSED. The first review proposed pinning discount codes to
-- a character allow-list. That was declined on the grounds that the write path normalises but does
-- not restrict the character set, so the constraint would reject codes an admin could legitimately
-- create. That reasoning was simply WRONG: manage-discount-codes/index.ts:31 already rejects
-- anything outside `^[A-Z0-9_.+-]{1,60}$`, as the second review pointed out. With the fact
-- corrected the constraint costs nothing and closes a real gap, so it is in below - copied verbatim
-- from the writer so there is one shape, not two. It is no longer an injection fix (with .eq() a
-- stored '%' is a literal), it is the same "enforce the invariant rather than assume it" move as the
-- email constraints.
--
-- LOCKING, honestly. Adding a validated CHECK constraint takes a brief ACCESS EXCLUSIVE lock and
-- scans the table. On these tables that is nothing (2 rows, 1 row, and 0 rows respectively), so
-- NOT VALID plus a later VALIDATE CONSTRAINT would be pure ceremony here. On a table of any size it
-- would be the right call, and this comment is the reminder for whoever copies this pattern.
--
-- ADDITIVE and idempotent (duplicate_object swallowed), matching 048's pattern. Nothing is dropped
-- and no column changes type. Safe to re-run.
--
-- Apply:  supabase db query --linked --file supabase/migrations/049_case_invariants_for_eq_lookups.sql

-- admin_users.email - read by _shared/caller.ts, send-handoff, manage-admin-users (x3) and
-- inbound-message. The inbound-message one is why this matters most: it resolves the From header of
-- an inbound email against this table to decide whether a message was sent by an admin, so a row
-- that stopped matching would silently reclassify that person's replies as coming from a studio.
do $$ begin
  alter table public.admin_users
    add constraint admin_users_email_normalised
    check (email = lower(email) and email !~ '\s');
exception when duplicate_object then null;
end $$;

-- external_contacts.email - read by create-quote and create-custom-invoice to converge repeat
-- invoicing on one contact row. A row that stopped matching would not error; it would quietly create
-- a duplicate contact and split one person's billing history across two records.
do $$ begin
  alter table public.external_contacts
    add constraint external_contacts_email_normalised
    check (email = lower(email) and email !~ '\s');
exception when duplicate_object then null;
end $$;

-- discount_codes.code - the write path and the checkout reader now import ONE normaliser
-- (_shared/discount-code.ts: trim, upper-case, collapse whitespace runs to a hyphen), and the writer
-- then validates the result against the pattern below. This is that pattern, copied verbatim from
-- manage-discount-codes/index.ts:31, so a code can never be stored in a shape the checkout is unable
-- to construct or match. It subsumes upper-case-only, no-whitespace and non-empty in one expression:
-- '' fails the {1,60} bound, and '' is worth excluding explicitly because .eq('code', '') would
-- match a stored empty string perfectly happily.
do $$ begin
  alter table public.discount_codes
    add constraint discount_codes_code_normalised
    check (code ~ '^[A-Z0-9_.+\-]{1,60}$');
exception when duplicate_object then null;
end $$;
