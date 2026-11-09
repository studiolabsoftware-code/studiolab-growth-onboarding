# Growth - Onboarding steward card (seat set 9 Nov 2026)

Steward: this session (standing; the supervisor pins and files it in the Growth - Onboarding group). Reports to the supervisor `local_12f8e1c4`. Hub: `StudioLAB-Shared/projects/growth-onboarding/PROJECT.md`.

## Exact next step
Critic result is now below. Next: fix the two findings, run the full gate (typecheck, build, tests, code-review standard), open the PR into `main`, report the PR to supervisor `local_12f8e1c4`. Allowance wrap-up 9 Nov: branch pushed as wip, no PR yet.

## Critic findings (read 9 Nov, verified by reading only; fix both before the PR)
1. HIGH: save-draft only checks the phone when `finalize===true`, but nothing sends finalize any more (payment goes save-draft, create-checkout-session, Stripe webhook sets submitted). Put the phone check (stored value valid E.164 with consent_at) in `create-checkout-session` and refuse with `phone_required`.
2. HIGH: `studio-self-edit` rejects the whole save when `contact_phone` is not a valid mobile, and account.html sends every contact field each save. Existing studios with a landline, empty phone, null region, or a UK/NZ national-format number cannot edit name or role. Fix: only validate and stamp the phone when it differs from the stored value (and allow an unchanged legacy value); decision for Gary is whether to chase legacy numbers.
Checked fine: consent fields not client-writable; client and server toE164 agree; Guided drafts coerce to dfy.

## Needs Gary
1. Apply `supabase/migrations/056_contact_phone_consent.sql` by hand, THEN deploy `save-draft`, `studio-self-edit`, `resolve-pricing`, `create-checkout-session`, `studio-request`, THEN merge the PR (Pages publishes `form.js` on push to main; functions first). Live DB and deploy are not done by this session.
2. Existing Guided-paid studios (if any) keep the old account-page wording; confirm none are live or say if the Guided banner and checklist copy in `site/account.html` should go too.

## Register of sessions
| Session | Branch / PR | State |
|---|---|---|
| this steward + build | `claude/guided-removal-and-mobile`, worktree `.claude/worktrees/guided-removal-and-mobile` | pushed, no PR yet; unbriefed critic launched |

## Rulings in force
- Guided self-setup withdrawn (GARY-DIRECTIVES 9 Nov, D90). Done-For-You is the only setup.
- Required mobile at signup (D79): notice word for word, no tick box, E.164 + `contact_phone_consent_at/source`, account and support texts only.
