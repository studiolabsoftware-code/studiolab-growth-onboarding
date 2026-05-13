// Studio-portal attachment upload. Multipart endpoint that accepts:
//   - field 'conversation_id' (uuid)
//   - field 'token'           (raw studio token for the conversation)
//   - field 'message_id'      (the message row this attachment belongs to —
//                              must be a studio-role message in this conv)
//   - field 'file'            (the actual file blob; <= 10 MB)
//
// On success, uploads to the message-attachments bucket and inserts a
// message_attachments row. Returns the row id and storage path.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verifyStudioToken } from '../_shared/inbox.ts';

const MAX = 10 * 1024 * 1024;

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  try {
    const form = await req.formData();
    const conversationId = String(form.get('conversation_id') || '');
    const token = String(form.get('token') || '');
    const messageId = String(form.get('message_id') || '');
    const file = form.get('file');

    if (!conversationId || !token || !messageId) {
      return jsonResponse({ ok: false, error: 'Missing required fields.' }, 400);
    }
    if (!(file instanceof File)) {
      return jsonResponse({ ok: false, error: 'No file provided.' }, 400);
    }
    if (file.size > MAX) {
      return jsonResponse({ ok: false, error: 'File exceeds the 10 MB limit.' }, 413);
    }

    const sb = adminClient();
    const auth = await verifyStudioToken(sb, conversationId, token);
    if (!auth.ok) return jsonResponse({ ok: false, error: 'Invalid or revoked link.' }, 401);

    // Confirm the message belongs to this conversation and is a studio message.
    const { data: msg } = await sb.from('messages')
      .select('id, conversation_id, sender_role')
      .eq('id', messageId)
      .maybeSingle();
    if (!msg || msg.conversation_id !== conversationId || msg.sender_role !== 'studio') {
      return jsonResponse({ ok: false, error: 'Message not found in this conversation.' }, 404);
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 120);
    const path = `${conversationId}/${messageId}/${Date.now()}-${safeName}`;
    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await sb.storage
      .from('message-attachments')
      .upload(path, buf, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
    if (upErr) {
      console.error('storage upload failed', upErr);
      return jsonResponse({ ok: false, error: 'Upload failed.' }, 500);
    }

    const { data: row, error: rowErr } = await sb.from('message_attachments').insert({
      message_id: messageId,
      storage_path: path,
      filename: safeName,
      content_type: file.type || null,
      size_bytes: file.size,
    }).select('id').single();
    if (rowErr) throw rowErr;

    return jsonResponse({ ok: true, attachment_id: row.id, storage_path: path });
  } catch (err) {
    console.error('portal-attach error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
