-- Two additions for the abandoned-onboarding programme (2026-08-20).
--
-- 1. Escalation. Chasing the studio by email is not enough on its own: the
--    studios most at risk are the ones our email never reached, and they look
--    identical to the ones who simply ignored it. So after a week with no
--    movement the account owner gets told, with the delivery status of what we
--    sent, and follows up personally.
--
-- 2. Ops reminders. A standing internal nag with an off switch, so a task that
--    only a human can do does not quietly get forgotten. First use: turning off
--    the platform's own signup email once ours is proven live.

alter table public.submissions
  add column if not exists onboarding_escalated_at timestamptz;

comment on column public.submissions.onboarding_escalated_at is
  'When the account owner was told this studio has stalled and needs a personal follow-up. Set once; the escalation does not repeat.';

create table if not exists public.ops_reminders (
  id              uuid primary key default gen_random_uuid(),
  -- Stable handle so a reminder can be found and flipped without knowing its id.
  key             text not null unique,
  title           text not null,
  body            text not null,
  -- False stops the reminders. Set by the one-click link in the email itself,
  -- so closing one never needs a deploy or a hand-written SQL statement.
  active          boolean not null default true,
  interval_days   integer not null default 2,
  last_sent_at    timestamptz,
  completed_at    timestamptz,
  -- Bearer for the one-click "mark this done" link. Random, single purpose,
  -- and useless for anything else: worst case someone closes a reminder.
  done_token      text not null default encode(gen_random_bytes(24), 'hex'),
  created_at      timestamptz not null default now()
);

comment on table public.ops_reminders is
  'Standing internal reminders for tasks only a human can do. Emailed to the account owner on interval_days until the one-click link in the email sets active = false.';

create index if not exists ops_reminders_active_idx
  on public.ops_reminders (active, last_sent_at) where active;

-- Service-role only. Nothing in the browser reads or writes this; the
-- one-click endpoint runs server-side with the service key.
alter table public.ops_reminders enable row level security;

-- The first one. Sequencing matters here and the body says so: the platform's
-- signup email is currently the ONLY thing that gets a studio to the form, so
-- turning it off before our own invite is proven live would leave new studios
-- with no way in at all.
insert into public.ops_reminders (key, title, body, interval_days)
values (
  'disable-platform-signup-email',
  'Turn off the platform''s own signup email, but not yet',
  'You said you would disable the signup email the platform sends, since ours replaces it. Do not turn it off yet. Right now that email is the only thing that gets a new studio to the onboarding form: our own invite path is built but not deployed, its database tables do not exist, and the signup webhook is not pointed at us. Turn it off only after a real signup has produced our invite email. The order is: apply the Connector migrations, deploy signup-webhook-receiver, point the platform''s signup automation at it, watch one real signup land, then disable the platform email.',
  2
)
on conflict (key) do nothing;
