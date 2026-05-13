-- =============================================================================
-- Per-studio unified inbox
-- =============================================================================
-- One conversation per submission. Either side (admin or studio) can post via
-- the web UI or by replying to a notification email routed through
-- inbox.studiolabgrowth.com (Mailgun route -> inbound-message edge function).
--
-- Messages carry a visibility flag so admins can leave internal-only notes for
-- each other inside the same studio's thread without the studio ever seeing
-- them. System events (payment received, scrape completed, KB confirmed)
-- append as sender_role='system' rows to give both sides a single timeline.
-- =============================================================================

create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  submission_id        uuid not null references public.submissions(id) on delete cascade,
  subject              text,
  status               text not null default 'open'
                         check (status in ('open','archived')),
  created_at           timestamptz not null default now(),
  last_message_at      timestamptz not null default now(),
  admin_unread_count   int not null default 0,
  studio_unread_count  int not null default 0,
  -- Studio access link is `portal.html?conv=<id>&t=<token>`. The token only
  -- grants access to this one conversation, so it is stored as-is (raw) so
  -- subsequent notification emails can keep embedding the same stable link.
  -- Admin can rotate the token from the dashboard to invalidate previously
  -- shared links if needed.
  studio_token         text,
  studio_token_rotated_at timestamptz,
  unique (submission_id)
);

create index if not exists conversations_last_message_at_idx
  on public.conversations (last_message_at desc);

create index if not exists conversations_status_idx
  on public.conversations (status, last_message_at desc);

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
-- sender_role:
--   'admin'  posted by an admin (web or email reply matched to admin_users)
--   'studio' posted by the studio side (web token flow OR any email reply that
--            arrived on a valid reply+<conv_id>@inbox.studiolabgrowth.com
--            address and was NOT from a known admin)
--   'system' auto-appended event (payment, scrape, KB confirmation, etc.)
--
-- visibility:
--   'studio'   visible to both sides
--   'internal' visible to admins only — used for admin-to-admin notes inside
--              the same thread
-- -----------------------------------------------------------------------------
create table if not exists public.messages (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      uuid not null references public.conversations(id) on delete cascade,
  sender_role          text not null check (sender_role in ('admin','studio','system')),
  visibility           text not null default 'studio'
                         check (visibility in ('studio','internal')),
  sender_email         text,
  sender_name          text,
  sender_admin_id      uuid references public.admin_users(id) on delete set null,
  body_text            text,
  body_html            text,
  inbound_message_id   text,   -- Message-Id header of inbound email (dedupe)
  outbound_message_id  text,   -- Message-Id we set on our outbound notification
  in_reply_to          text,   -- parent Message-Id (threading in email clients)
  created_at           timestamptz not null default now(),
  read_by_admin_at     timestamptz,
  read_by_studio_at    timestamptz,
  check (sender_role <> 'system' or visibility = 'studio'),
  check (sender_role <> 'studio' or visibility = 'studio')
);

create unique index if not exists messages_inbound_id_uniq
  on public.messages (inbound_message_id)
  where inbound_message_id is not null;

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at);

-- -----------------------------------------------------------------------------
-- message_attachments
-- -----------------------------------------------------------------------------
-- 10 MB hard cap per file, enforced here and at the upload boundary (web +
-- inbound email). Oversize email attachments are rejected with a bounce.
-- -----------------------------------------------------------------------------
create table if not exists public.message_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references public.messages(id) on delete cascade,
  storage_path  text not null,
  filename      text not null,
  content_type  text,
  size_bytes    int not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at    timestamptz not null default now()
);

create index if not exists message_attachments_message_idx
  on public.message_attachments (message_id);

-- -----------------------------------------------------------------------------
-- conversation_admin_subscriptions
-- -----------------------------------------------------------------------------
-- Default notification rules (computed at send time, no row required):
--   * owner role   -> subscribed to every conversation
--   * admin / va   -> subscribed iff currently assigned to the submission
--                     via submission_assignments
-- A row in this table overrides the default for a specific admin on a
-- specific conversation. Used when an admin wants to opt IN to a thread they
-- aren't assigned to, or OUT of one they don't want pings from.
-- -----------------------------------------------------------------------------
create table if not exists public.conversation_admin_subscriptions (
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  admin_user_id    uuid not null references public.admin_users(id) on delete cascade,
  subscribed       boolean not null,
  updated_at       timestamptz not null default now(),
  primary key (conversation_id, admin_user_id)
);

-- =============================================================================
-- Trigger: keep last_message_at and unread counters in sync on insert
-- =============================================================================
create or replace function public.bump_conversation_on_message()
returns trigger
language plpgsql
as $$
begin
  update public.conversations c
     set last_message_at = new.created_at,
         admin_unread_count = c.admin_unread_count + case
           -- Studio replies bump the admin inbox.
           when new.sender_role = 'studio' and new.visibility = 'studio' then 1
           -- Internal admin notes bump other admins' inboxes too. We don't
           -- discount the author here; the UI marks-as-read when they open
           -- the thread.
           when new.sender_role = 'admin' and new.visibility = 'internal' then 1
           else 0
         end,
         studio_unread_count = c.studio_unread_count + case
           when new.sender_role = 'admin' and new.visibility = 'studio' then 1
           when new.sender_role = 'system' then 1
           else 0
         end
   where c.id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_bump_conversation on public.messages;
create trigger messages_bump_conversation
  after insert on public.messages
  for each row execute function public.bump_conversation_on_message();

-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Same convention as the rest of the schema: authenticated = admin (login is
-- gated by admin_users via an edge function with the service role key).
-- Studio access happens through edge functions that validate the magic-link
-- token, so no anon policy is needed on these tables.
-- =============================================================================
alter table public.conversations                     enable row level security;
alter table public.messages                          enable row level security;
alter table public.message_attachments               enable row level security;
alter table public.conversation_admin_subscriptions  enable row level security;

drop policy if exists conversations_all_admin on public.conversations;
create policy conversations_all_admin on public.conversations
  for all to authenticated using (true) with check (true);

drop policy if exists messages_all_admin on public.messages;
create policy messages_all_admin on public.messages
  for all to authenticated using (true) with check (true);

drop policy if exists message_attachments_all_admin on public.message_attachments;
create policy message_attachments_all_admin on public.message_attachments
  for all to authenticated using (true) with check (true);

drop policy if exists conv_admin_subs_all_admin on public.conversation_admin_subscriptions;
create policy conv_admin_subs_all_admin on public.conversation_admin_subscriptions
  for all to authenticated using (true) with check (true);

-- =============================================================================
-- Storage bucket for message attachments
-- =============================================================================
-- Private bucket. Admins read directly; studios read via signed URLs minted
-- by an edge function after validating the magic-link token. All writes go
-- through edge functions using the service role key.
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('message-attachments', 'message-attachments', false)
on conflict (id) do nothing;

drop policy if exists message_attachments_admin_read on storage.objects;
create policy message_attachments_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'message-attachments');
