// Shared helpers for the per-studio inbox: subscription resolution,
// reply-address builder, message-id mint, and notification rendering.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const INBOUND_DOMAIN = Deno.env.get('INBOX_DOMAIN') || 'inbox.studiolabgrowth.com';
export const OUTBOUND_MSGID_DOMAIN = Deno.env.get('MAILGUN_DOMAIN') || 'studiolabgrowth.com';

export interface AdminRecipient {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

// Returns the email addresses of every admin that should be notified for a
// message on the given conversation, excluding `excludeAdminId` (the author).
//
// Rules:
//   * Owner role  → always subscribed, no opt-out (Gary wants every thread)
//   * Admin / VA  → subscribed iff currently assigned to the submission via
//                   submission_assignments (active = not cancelled/completed)
//   * Override    → a row in conversation_admin_subscriptions with
//                   subscribed=true|false wins over the default for that pair
export async function resolveAdminRecipients(
  sb: SupabaseClient,
  conversationId: string,
  submissionId: string,
  excludeAdminId: string | null,
): Promise<AdminRecipient[]> {
  const [{ data: admins }, { data: assignments }, { data: overrides }] = await Promise.all([
    sb.from('admin_users').select('id, email, name, role').eq('is_active', true),
    sb.from('submission_assignments')
      .select('admin_user_id')
      .eq('submission_id', submissionId)
      .in('status', ['assigned', 'in_progress', 'needs_recheck']),
    sb.from('conversation_admin_subscriptions')
      .select('admin_user_id, subscribed')
      .eq('conversation_id', conversationId),
  ]);

  const assignedIds = new Set((assignments || []).map((a) => a.admin_user_id));
  const overrideMap = new Map((overrides || []).map((o) => [o.admin_user_id, o.subscribed]));

  const recipients: AdminRecipient[] = [];
  for (const a of admins || []) {
    if (excludeAdminId && a.id === excludeAdminId) continue;
    const override = overrideMap.get(a.id);
    let subscribed: boolean;
    if (a.role === 'owner') {
      // Owner is always subscribed; an explicit override CAN opt them out, but
      // we deliberately ignore overrides for the owner so Gary sees everything.
      subscribed = true;
    } else if (override !== undefined) {
      subscribed = override;
    } else {
      subscribed = assignedIds.has(a.id);
    }
    if (subscribed) recipients.push(a as AdminRecipient);
  }
  return recipients;
}

export function replyAddress(conversationId: string): string {
  return `reply+${conversationId}@${INBOUND_DOMAIN}`;
}

// RFC-822 Message-Id we attach to outbound notifications so replies can be
// threaded by email clients AND so we can match a reply back to its parent
// inside our DB via the In-Reply-To header.
export function mintMessageId(messageRowId: string): string {
  return `<msg-${messageRowId}@${OUTBOUND_MSGID_DOMAIN}>`;
}

export function buildThreadingHeaders(opts: {
  selfMessageId: string;
  parentMessageId?: string | null;
  referencesChain?: string[];
}): Record<string, string> {
  const headers: Record<string, string> = { 'Message-Id': opts.selfMessageId };
  if (opts.parentMessageId) {
    headers['In-Reply-To'] = opts.parentMessageId;
    const refs = (opts.referencesChain || []).concat(opts.parentMessageId).join(' ');
    headers['References'] = refs;
  }
  return headers;
}

// Stable subject so Gmail collapses the thread.
export function threadSubject(studioName: string, subject: string | null, isReply: boolean): string {
  const base = `${studioName} — ${subject?.trim() || 'New message'}`;
  return isReply ? `Re: ${base}` : base;
}

// Mint or reuse a studio access token for a conversation. Stored raw because
// it only unlocks ONE conversation — bounded blast radius — and we want every
// notification email to embed the same stable link so a studio can come back
// to an older email and the link still works. Admin can rotate via the
// dashboard to invalidate all previously shared links.
export async function ensureStudioToken(
  sb: SupabaseClient,
  conversationId: string,
): Promise<string> {
  const { data: existing } = await sb
    .from('conversations')
    .select('studio_token')
    .eq('id', conversationId)
    .single();
  if (existing?.studio_token) return existing.studio_token;
  const raw = randomTokenHex(32);
  await sb.from('conversations')
    .update({ studio_token: raw, studio_token_rotated_at: new Date().toISOString() })
    .eq('id', conversationId);
  return raw;
}

function randomTokenHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Validates a studio token against the stored value. Used by portal-* edge
// functions to authorise studio-side reads/writes.
export async function verifyStudioToken(
  sb: SupabaseClient,
  conversationId: string,
  rawToken: string,
): Promise<{ ok: boolean; submissionId?: string }> {
  if (!rawToken || !conversationId) return { ok: false };
  const { data } = await sb
    .from('conversations')
    .select('id, submission_id, studio_token')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data || !data.studio_token) return { ok: false };
  if (!constantTimeEq(data.studio_token, rawToken)) return { ok: false };
  return { ok: true, submissionId: data.submission_id };
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Idempotent conversation lookup — used by system-event appenders that may
// fire before the admin has opened the inbox tab for a studio.
export async function ensureConversationForSubmission(
  sb: SupabaseClient,
  submissionId: string,
  studioName?: string | null,
): Promise<string> {
  const { data: existing } = await sb
    .from('conversations')
    .select('id')
    .eq('submission_id', submissionId)
    .maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await sb
    .from('conversations')
    .insert({
      submission_id: submissionId,
      subject: studioName ? `Conversation with ${studioName}` : null,
    })
    .select('id')
    .single();
  if (error || !created) throw error || new Error('Failed to create conversation.');
  return created.id;
}

// Append a system event to the conversation. Never sends email (the
// notify-new-message function bails on sender_role='system'). Use this for
// payment received, scrape completed, KB confirmed, change-request applied,
// status transitions, etc.
export async function postSystemMessage(
  sb: SupabaseClient,
  submissionId: string,
  studioName: string | null,
  text: string,
): Promise<void> {
  try {
    const conversationId = await ensureConversationForSubmission(sb, submissionId, studioName);
    await sb.from('messages').insert({
      conversation_id: conversationId,
      sender_role: 'system',
      visibility: 'studio',
      body_text: text,
    });
  } catch (err) {
    // System messages are best-effort — never block the underlying workflow.
    console.error('postSystemMessage failed:', err);
  }
}
