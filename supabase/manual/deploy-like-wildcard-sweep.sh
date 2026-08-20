#!/usr/bin/env bash
# LIKE-wildcard sweep: apply migration 049, then redeploy every function that carries the fix.
#
# WHAT THIS CLOSES. A day after the send-otp / verify-otp injection was fixed, a sweep found nine
# more `.ilike()` lookups on values a caller can influence. `%` and `_` are LIKE wildcards, so each
# was a pattern match wearing a lookup's clothes. Two of them mattered:
#
#   * _shared/pricing.ts - `discount_code` comes straight off the request body of
#     create-checkout-session, a PUBLIC path. Posting `%` matched whatever single code was in the
#     table, applying a discount the caller was never given and never knew the name of. It was
#     unexploitable on the day it was found only by luck: the one code in the table had expired.
#   * inbound-message - the lookup runs against the From header of an INBOUND EMAIL, so anyone able
#     to send mail to the inbound address controlled it. A From of `%@yourdomain.com` matched an
#     admin row and filed the message as sent BY that admin. Sender spoofing from an unauthenticated
#     position.
#
# WHY 25 FUNCTIONS FOR A NINE-LINE FIX. Two of the changed files are in `_shared/`, and Supabase
# bundles shared sources into each function AT DEPLOY TIME. A shared fix therefore reaches a function
# only when that function is itself redeployed. Deploying just the urgent ones would leave the repo
# saying `.eq()` while twenty deployed functions still ran `.ilike()`, which is exactly the kind of
# split between source and production that costs a future session an afternoon.
#
# NO --no-verify-jwt FLAGS ANYWHERE, deliberately. This repo has a supabase/config.toml that declares
# verify_jwt per function, and `supabase functions deploy` reads it. Passing flags by hand here would
# be a second, unversioned source of truth for the one setting that 401s an entire function when it
# is wrong.
#
# ORDER. The three functions carrying a live defect deploy FIRST, so that a failure part-way through
# still leaves the important half done.
#
# Usage:  bash supabase/manual/deploy-like-wildcard-sweep.sh
set -euo pipefail

REPO="/Users/gary/Claude_Projects/Growth - Onboarding"
REF="hiaruvsdamggenhqdvtp"
cd "$REPO"

say() { printf '\n=== %s ===\n' "$1"; }
die() { printf '\nABORTED: %s\n' "$1" >&2; exit 1; }

LINKED_REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
[ -n "$LINKED_REF" ] && [ "$LINKED_REF" != "$REF" ] \
  && die "this repo is linked to '$LINKED_REF' but the sweep targets '$REF'."

# The three that carry a live defect, first.
URGENT=(create-checkout-session resolve-pricing inbound-message)
# The rest: everything else that imports _shared/caller.ts or was edited directly.
REST=(
  send-handoff manage-admin-users create-custom-invoice create-quote
  admin-apply-request admin-decline-request admin-mark-active cancel-quote
  cleanup-attachments create-project delete-submission-attachment
  get-attachment-download-url get-quote-pdf list-submission-attachments
  manage-deliverable manage-discount-codes manage-invoice manage-products
  quote-reminders save-payment-settings stripe-test-connection
  upload-submission-attachment
)

# ---------------------------------------------------------------------------------------------
say "1/5  Running the repo's own gate before touching production"
# ---------------------------------------------------------------------------------------------
# The guard test is the point of this step: it scans every Edge Function source and fails if ANY
# form of LIKE match survives, including the operator-string spellings PostgREST also accepts. If it
# fails there is no sense deploying, because the thing being fixed is still in the code.
deno test --allow-read supabase/functions/_shared/ || die "the test gate failed. Nothing deployed."
for f in "${URGENT[@]}" "${REST[@]}"; do
  deno check "supabase/functions/$f/index.ts" >/dev/null 2>&1 || die "deno check failed on $f. Nothing deployed."
done
echo "gate green: tests pass and all 25 functions type-check"

# ---------------------------------------------------------------------------------------------
say "2/5  Applying migration 049 (the invariants .eq() now depends on)"
# ---------------------------------------------------------------------------------------------
# Additive CHECK constraints, verified beforehand to validate against every existing row. They pin
# what the code already does, so an insert path that skipped normalisation fails loudly instead of
# silently producing a row that can never be matched again.
supabase db query --linked --file supabase/migrations/049_case_invariants_for_eq_lookups.sql

# ---------------------------------------------------------------------------------------------
say "3/5  Verifying the constraints exist and hold"
# ---------------------------------------------------------------------------------------------
CON_JSON="$(supabase db query --linked --output json "
  select count(*) = 3 as all_ok from pg_constraint
   where conname in ('admin_users_email_normalised',
                     'external_contacts_email_normalised',
                     'discount_codes_code_normalised')
     and convalidated;" 2>&1 || true)"
echo "$CON_JSON"
printf '%s' "$CON_JSON" | grep -q '"all_ok": *true' \
  || die "the three constraints did not all land as VALIDATED. Nothing has been deployed."

# ---------------------------------------------------------------------------------------------
say "4/5  Deploying the three functions carrying a live defect"
# ---------------------------------------------------------------------------------------------
for f in "${URGENT[@]}"; do
  printf '\n--- %s ---\n' "$f"
  supabase functions deploy "$f" --project-ref "$REF"
done

# ---------------------------------------------------------------------------------------------
say "5/5  Deploying the remaining 22 that carry the shared fix"
# ---------------------------------------------------------------------------------------------
# Slower than it looks worth being: each of these is a no-op behaviourally except that it picks up
# the corrected _shared/caller.ts. Takes a few minutes. If one fails, note WHICH and re-run - the
# script is safe to run again from the top, and steps 2 and 3 are idempotent.
for f in "${REST[@]}"; do
  printf '\n--- %s ---\n' "$f"
  supabase functions deploy "$f" --project-ref "$REF"
done

say "Done"
cat <<'NOTE'
The sweep is live. Nothing to smoke by hand here: the change is a swap from pattern-matching to
exact matching on lookups that already only ever received exact values, so correct behaviour looks
identical to what you had. What changed is what a hostile value can do.

Two things worth knowing rather than testing:

  * Discount codes. There are none in the table right now. When you create one, it must match
    A-Z, 0-9, hyphen, underscore, period or plus, 1-60 characters. The admin screen already enforced
    that; the database now enforces it too, so the two cannot drift apart.

  * A code with a space in it, like "EARLY BIRD", is stored as "EARLY-BIRD". It always was. The
    difference is that checkout now applies the same rule, so a customer typing it with the space
    gets a match instead of "not recognised". That was broken before and nobody had noticed,
    because there has never been a live code to notice it with.
NOTE
