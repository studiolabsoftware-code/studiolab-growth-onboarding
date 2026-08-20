#!/usr/bin/env bash
# Tier-1 onboarding pre-fill: apply the submissions column and deploy the two OTP functions.
#
# What this changes for a studio: clicking their StudioLAB Growth invite link no longer asks for the
# email address we already hold, and step 1 arrives filled in with their studio name and their name
# instead of blank. They still enter a code, which is deliberate: the link is a bearer credential
# sitting in an inbox.
#
# Usage:  bash supabase/manual/deploy-prefill.sh
#
# RUN THIS BEFORE YOU PUSH TO main. THIS IS THE ONE THING TO GET RIGHT.
#
# js/form.js is served by GitHub Pages straight from main, so ANY push publishes it - including a
# push that only adds an unrelated file. If the new form.js reaches studios before these functions
# are deployed, the browser sends the invite token to a send-otp that has never heard of it, the old
# function answers "Invalid email address", and because the email box is hidden on that path every
# studio holding a live invite link is locked out until someone notices. The form now falls back to
# email entry on any failure, which softens it, but the ordering is still: run this script, wait for
# Done, then push.
#
# ORDER MATTERS INSIDE THE SCRIPT TOO. The Connector's resolver RPC must exist BEFORE these functions
# go live, or every pre-bind request fails closed and studios silently fall back to typing their
# email. This script refuses to deploy until it can actually CALL the RPC, not merely see it.
set -euo pipefail

REPO="/Users/gary/Claude_Projects/Growth - Onboarding"
REF="hiaruvsdamggenhqdvtp"
cd "$REPO"

say() { printf '\n=== %s ===\n' "$1"; }
die() { printf '\nABORTED: %s\n' "$1" >&2; exit 1; }

# The DB steps below use --linked while the function deploys use --project-ref. If those ever point
# at different projects, this script would apply the column to one and deploy code expecting it to
# another. Prove they agree before touching anything.
LINKED_REF="$(cat supabase/.temp/project-ref 2>/dev/null || true)"
if [ -n "$LINKED_REF" ] && [ "$LINKED_REF" != "$REF" ]; then
  die "this repo is linked to '$LINKED_REF' but the script deploys to '$REF'.
Re-link with: supabase link --project-ref $REF"
fi

# ---------------------------------------------------------------------------------------------
say "1/4  Checking the Connector's resolver RPC exists"
# ---------------------------------------------------------------------------------------------
# growth_manager belongs to the Growth Connector repo, so its migration is applied from there. This
# is a gate, not an apply: this repo must never DDL another repo's schema.
# CALL it, do not merely look it up. to_regprocedure reads the Postgres catalog, which says nothing
# about whether PREBIND_TOKEN_PEPPER is in the vault, whether extensions.hmac resolves under the
# function's empty search_path, or whether the grant is right. A well-formed but impossible token is
# the perfect probe: it exercises the pepper read, the HMAC and the lookup, returns zero rows, and has
# no side effects. Without this the gate can report success on a completely dead path, and every
# studio would be told their link was invalid while the real fault sat in the vault.
RPC_JSON="$(supabase db query --linked --output json \
  "select count(*) >= 0 as rpc_ok from growth_manager.resolve_signup_by_token(repeat('0', 64));" 2>&1 || true)"
echo "$RPC_JSON"
if ! printf '%s' "$RPC_JSON" | grep -q '"rpc_ok": *true'; then
  die "growth_manager.resolve_signup_by_token could not be called, so the pre-fill path cannot work.
The output above says why. The two usual causes:

  1. It does not exist yet. Create it from the Growth Connector repo:
       cd \"/Users/gary/Claude_Projects/Growth Connector\"
       supabase db query --linked --file supabase/migrations/20260820140000_resolve_signup_by_token.sql

  2. PREBIND_TOKEN_PEPPER is missing from the vault. Check with:
       supabase db query --linked \"select name from vault.secrets where name='PREBIND_TOKEN_PEPPER';\"
     It is created by the Connector's deploy-c1-receiver.sh and must NOT be rotated: it hashes every
     pre-bind token, so rotating it invalidates every invite link already in a studio's inbox.

Then re-run this script."
fi

# ---------------------------------------------------------------------------------------------
say "2/4  Applying migration 048 (submissions.location_id)"
# ---------------------------------------------------------------------------------------------
# Additive and idempotent: adds a nullable column plus a partial index. Nothing is dropped and no
# existing column changes type, so this is safe against the live table.
supabase db query --linked --file supabase/migrations/048_submission_location_id.sql

# ---------------------------------------------------------------------------------------------
say "3/4  Verifying the column landed"
# ---------------------------------------------------------------------------------------------
COL_JSON="$(supabase db query --linked --output json "
  select (select count(*) from information_schema.columns
            where table_schema='public' and table_name='submissions'
              and column_name='location_id' and data_type='text') = 1
     and (select count(*) from pg_indexes
            where schemaname='public' and tablename='submissions'
              and indexname='submissions_location_id_idx') = 1
       as all_ok;" 2>&1 || true)"
echo "$COL_JSON"
printf '%s' "$COL_JSON" | grep -q '"all_ok": *true' \
  || die "submissions.location_id did not verify. The functions are NOT being deployed: verify-otp
would try to stamp a column that does not exist and fail every sign-in."

# ---------------------------------------------------------------------------------------------
say "4/4  Deploying the changed functions, and restoring three gateway-blocked ones"
# ---------------------------------------------------------------------------------------------
# --no-verify-jwt is REQUIRED, not optional, and it is also declared in supabase/config.toml. The
# browser calls both of these with NO Authorization header (js/form.js callFn), so on the platform
# default the gateway 401s every request before our code runs and NO studio can sign in - including
# the ones already midway through onboarding. Verified against production on 2026-08-20 that this is
# the current live setting. Passing it explicitly as well as declaring it means neither a stale
# config nor a forgotten flag can take the form offline.
supabase functions deploy send-otp   --project-ref "$REF" --no-verify-jwt
supabase functions deploy verify-otp --project-ref "$REF" --no-verify-jwt

# save-draft is changed BY THIS SLICE (it now seeds an already-signed-in studio from the invite
# token), so it has to go out regardless. It also happens to be broken in production right now, which
# is how that was noticed: verified 2026-08-20 that an unauthenticated POST to the live save-draft
# returns the GATEWAY's 401 UNAUTHORIZED_NO_AUTH_HEADER, while the same request carrying the
# publishable key reaches our code. js/form.js sent no header at all, so every autosave has been
# failing silently. Redeploying with the flag restores it.
supabase functions deploy save-draft --project-ref "$REF" --no-verify-jwt

# Same fault, same fix, NOT part of this slice's code changes: these two are also gateway-blocked
# while the pages that call them send no header, so account.html and the change-request apply flow
# are equally dead. Their code is untouched; only the gateway flag changes.
supabase functions deploy get-studio-account    --project-ref "$REF" --no-verify-jwt
supabase functions deploy apply-change-request  --project-ref "$REF" --no-verify-jwt

say "Done"
cat <<'NOTE'
The server half is live. NOW push main: js/form.js is static and ships via GitHub Pages, not from
this script.

Then smoke it end to end with a REAL invite link, not a hand-made URL.

  0. Open a PRIVATE / incognito window. This matters more than it sounds. You almost certainly have a
     valid 90-day session from your earlier run-through, and with a session the form skips the sign-in
     gate entirely and drops you straight into your old draft - which looks exactly like the feature
     being broken.

  1. From the Growth Connector repo, send yourself a synthetic invite, using a PLUS-ALIAS you have
     never used on the form before:
       bash supabase/manual/smoke-c1-receiver.sh you+prefill1@yourdomain.com
     The alias matters: the seed deliberately never overwrites a field you have already filled, so
     smoking with an address that already has a draft would correctly write nothing and look like a
     failure.

  2. Click the link in that email. You should NOT be asked for your email address. You should see
     "We'll send a code to the email on your account" and a Send my code button. There is deliberately
     no masked address on screen: a forwarded link should not tell the holder whose account it is.

  3. Enter the code. Step 1 should arrive with the studio name (Smoke Test Dance Academy) and your
     name already filled in.

  4. Check the row was bound:
       supabase db query --linked "select studio_name, first_name, location_id from public.submissions
         where location_id is not null order by last_saved_at desc limit 5;"

  5. Clean up BOTH sides. The Connector smoke only clears its own table; the run above also stamped a
     synthetic SMOKE... location_id onto a real row in public.submissions, and that is the binding
     promote_verified_capture() would later act on:
       supabase db query --linked "delete from public.submissions where location_id like 'SMOKE%';"
       supabase db query --linked "delete from growth_manager.inbound_signup where location_id like 'SMOKE%';"

If step 2 still asks for your email address, the form JS has not shipped yet: push main and retry.
NOTE
