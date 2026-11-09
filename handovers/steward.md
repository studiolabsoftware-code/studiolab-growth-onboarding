# Growth - Onboarding steward card (seat set 9 Nov 2026)

Steward: this session (standing; the supervisor pins and files it in the Growth - Onboarding group). Reports to the supervisor `local_12f8e1c4`. Hub: `StudioLAB-Shared/projects/growth-onboarding/PROJECT.md`.

## Needs Gary
1. Apply `supabase/migrations/056_contact_phone_consent.sql` by hand, THEN deploy `save-draft`, `studio-self-edit`, `resolve-pricing`, `create-checkout-session`, `studio-request`, THEN merge the PR (Pages publishes `form.js` on push to main; functions first). Live DB and deploy are not done by this session.
2. Existing Guided-paid studios (if any) keep the old account-page wording; confirm none are live or say if the Guided banner and checklist copy in `site/account.html` should go too.

## Register of sessions
| Session | Branch / PR | State |
|---|---|---|
| this steward + build | `claude/guided-removal-and-mobile`, worktree `.claude/worktrees/guided-removal-and-mobile` | PR open, one unbriefed critic running |

## Rulings in force
- Guided self-setup withdrawn (GARY-DIRECTIVES 9 Nov, D90). Done-For-You is the only setup.
- Required mobile at signup (D79): notice word for word, no tick box, E.164 + `contact_phone_consent_at/source`, account and support texts only.
