// Studio-portal API. Single entry point for the studio side of the inbox so
// CORS, token validation, and rate limiting live in one place.
//
// Request body must always include { action, conversation_id, token }. The
// `action` field dispatches to one of:
//
//   'load'       — returns conversation + studio-visible messages (no internal
//                  notes), studio context (studio_name, contact_email), and
//                  any attachments.
//   'send'       — body: { body_text }. Inserts a studio-role message.
//   'mark-read'  — zeroes studio_unread_count.
//   'sign-url'   — body: { storage_path }. Returns a signed URL valid for
//                  10 min so the studio can download an attachment.
//
// Attachment UPLOADS use a separate function (portal-attach) because they
// are multipart/form-data; everything here is JSON.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verifyStudioToken } from '../_shared/inbox.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  try {
    const payload = await req.json();
    const { action, conversation_id, token } = payload || {};
    if (!action || !conversation_id || !token) {
      return jsonResponse({ ok: false, error: 'Missing required fields.' }, 400);
    }

    const sb = adminClient();
    const auth = await verifyStudioToken(sb, conversation_id, token);
    if (!auth.ok) return jsonResponse({ ok: false, error: 'Invalid or revoked link.' }, 401);

    switch (action) {
      case 'load':     return await actLoad(sb, conversation_id, auth.submissionId!);
      case 'send':     return await actSend(sb, conversation_id, payload, req);
      case 'mark-read':return await actMarkRead(sb, conversation_id);
      case 'sign-url': return await actSignUrl(sb, conversation_id, payload);
      default:         return jsonResponse({ ok: false, error: 'Unknown action.' }, 400);
    }
  } catch (err) {
    console.error('portal-conversation error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

async function actLoad(sb: any, conversationId: string, submissionId: string) {
  const [{ data: conv }, { data: sub }, { data: msgs }] = await Promise.all([
    sb.from('conversations')
      .select('id, subject, created_at, last_message_at, studio_unread_count')
      .eq('id', conversationId).single(),
    sb.from('submissions')
      .select('id, studio_name, contact_email, plan, status')
      .eq('id', submissionId).single(),
    // Studio side never sees admin internal notes.
    sb.from('messages')
      .select('id, sender_role, sender_name, body_text, body_html, created_at, read_by_studio_at')
      .eq('conversation_id', conversationId)
      .eq('visibility', 'studio')
      .order('created_at', { ascending: true }),
  ]);

  // Pull attachments in a second round.
  const msgIds = (msgs || []).map((m: any) => m.id);
  let attsByMsg: Record<string, any[]> = {};
  if (msgIds.length) {
    const { data: atts } = await sb.from('message_attachments')
      .select('id, message_id, storage_path, filename, content_type, size_bytes')
      .in('message_id', msgIds);
    (atts || []).forEach((a: any) => {
      (attsByMsg[a.message_id] = attsByMsg[a.message_id] || []).push(a);
    });
  }
  const withAtts = (msgs || []).map((m: any) => ({ ...m, attachments: attsByMsg[m.id] || [] }));

  return jsonResponse({ ok: true, conversation: conv, submission: sub, messages: withAtts });
}

async function actSend(sb: any, conversationId: string, payload: any, _req: Request) {
  const body = String(payload.body_text || '').trim();
  if (!body) return jsonResponse({ ok: false, error: 'Message is empty.' }, 400);
  if (body.length > 10000) return jsonResponse({ ok: false, error: 'Message too long.' }, 400);

  const html = textToHtml(body);
  const senderName = String(payload.sender_name || '').trim().slice(0, 80) || null;
  const senderEmail = String(payload.sender_email || '').trim().slice(0, 200) || null;

  const { data, error } = await sb.from('messages').insert({
    conversation_id: conversationId,
    sender_role: 'studio',
    visibility: 'studio',
    sender_email: senderEmail,
    sender_name: senderName,
    body_text: body,
    body_html: html,
  }).select('id').single();
  if (error) throw error;
  return jsonResponse({ ok: true, message_id: data.id });
}

async function actMarkRead(sb: any, conversationId: string) {
  await sb.from('conversations')
    .update({ studio_unread_count: 0 })
    .eq('id', conversationId);
  return jsonResponse({ ok: true });
}

async function actSignUrl(sb: any, conversationId: string, payload: any) {
  const storagePath = String(payload.storage_path || '');
  // Path safety: must live under this conversation's namespace.
  if (!storagePath.startsWith(conversationId + '/')) {
    return jsonResponse({ ok: false, error: 'Forbidden path.' }, 403);
  }
  // Confirm the attachment belongs to a studio-visible message in this conv.
  const { data: att } = await sb.from('message_attachments')
    .select('id, message_id, storage_path, message:messages!inner(visibility, conversation_id)')
    .eq('storage_path', storagePath)
    .maybeSingle();
  if (!att) return jsonResponse({ ok: false, error: 'Attachment not found.' }, 404);
  const visibility = (att as any).message?.visibility;
  const convOk = (att as any).message?.conversation_id === conversationId;
  if (!convOk || visibility !== 'studio') {
    return jsonResponse({ ok: false, error: 'Forbidden.' }, 403);
  }
  const { data, error } = await sb.storage
    .from('message-attachments')
    .createSignedUrl(storagePath, 600);
  if (error || !data?.signedUrl) {
    return jsonResponse({ ok: false, error: 'Could not sign URL.' }, 500);
  }
  return jsonResponse({ ok: true, signed_url: data.signedUrl });
}

function textToHtml(s: string): string {
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  return '<p>' + linked.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
}
