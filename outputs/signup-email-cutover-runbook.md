# Signup email cutover: status and pointer

Status: **READY TO EXECUTE.** Updated 2026-08-24. Supersedes the 2026-08-20 "do not execute yet"
version, whose blocking prerequisites are now all met and proven by a real click.

## Where the operational detail lives

The step-by-step pack, including the endpoint, its auth header, the payload contract and the exact
accepted plan and region values, is in the **private** Growth Connector repo:

`Growth Connector/docs/signup-email-cutover-pack.md`

This repo is public. A webhook whose only guard is a shared secret should not have its auth header
and payload shape published alongside it, so only the non-sensitive half is kept here.

## Why this cutover exists

StudioLAB Growth currently emails a new studio a plain link to the onboarding form. The token that
identifies the studio is minted by our receiver a fraction of a second **after** the signup fires,
so the platform does not have it at the moment its own automation runs. A platform-sent link cannot
tell the form who is arriving, and pre-fill never runs behind it, no matter how well the rest is
built. The forms those emails point at are correct and are not being thrown away. Only the sender
changes.

## What is already done, and proven

`signup-webhook-receiver` is deployed, live and inert; nothing calls it yet. Its shared secret was
rotated and verified on 2026-08-24, so the value that was once exposed in a session transcript is
dead. An unsigned probe confirms the function's own authentication is doing the gating rather than
the Supabase gateway. All six of `app.studiolabgrowth.com/{au,us}/{launch,scale,ai}` return 200, so
no invite can land on a dead route. Pre-fill, token resolve, OTP and the server-side `location_id`
stamp are live and were proven end to end by one synthetic invite on 2026-08-24. The `email_event`
ledger is live, so a bounced invite is now visible rather than silent.

`inbound_signup` and `email_event` are both empty. No real studio has ever completed this form.

## The ordering rule

The two changes have to happen in the same sitting, minutes apart, not days.

| Order | Result |
|---|---|
| Webhook on, platform emails still on | Two invites, two different links. Whether pre-fill works becomes a coin flip. |
| Platform emails off, webhook not on | Studios get nothing. Silent failure, and you learn about it from a complaint. |
| Both switched together | Correct. One email, carrying the token. |

## The audit that gates it

Before anything is disabled, list every place in StudioLAB Growth that emails a studio when their
sub-account is created: the signup automation itself, any second automation on the same trigger, the
SaaS-mode built-in emails, and any snapshot workflow that fires on the owner contact being created.

One carve-out matters enough to repeat here. **Keep the login-credentials email.** If Growth sends
the new studio their sub-account username and password, that is not an onboarding email, it is the
only way they get into Growth at all, and disabling it locks them out. The earlier version of this
runbook said "disable every onboarding or welcome email", which read literally would have killed it.
Disable the welcome template; keep the credentials one.

## Rollback

Re-enable the platform's onboarding emails. That restores today's behaviour immediately. Our invite
continuing to send alongside is the two-email state, untidy but harmless, and it buys time to
diagnose without any studio being stranded. Disable, do not delete, until several real studios have
come through cleanly.
