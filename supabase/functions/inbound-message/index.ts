// Mailgun route target. Receives an inbound email forwarded by Mailgun when
// someone replies to reply+<conversation_id>@inbox.studiolabgrowth.com, and
// turns it into a row in public.messages.
//
// Mailgun route config (set in Mailgun dashboard):
//   Filter:  match_recipient("reply\\+.*@inbox.studiolabgrowth.com")
//   Action:  forward("https://<project>.supabase.co/functions/v1/inbound-message")
//   Action:  store(notify="…optional…")    -- optional, for archival
//
// Mailgun's "forward" action POSTs the parsed email as multipart/form-data,
// including signed verification fields (timestamp, token, signature) and
// useful pre-stripped fields (stripped-text, stripped-html). We rely on those
// rather than parsing MIME ourselves.
//
// Sender role resolution:
//   * Sender email in admin_users (case-insensitive)  → admin
//   * Otherwise                                       → studio
// Gary's rule was "anyone with the link can reply" — we deliberately do NOT
// gate by the submission's contact email so a studio can forward the email
// chain to a colleague and have them reply directly.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';

const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_BUCKET = 'message-attachments';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  try {
    const form = await req.formData();

    // -------- Verify Mailgun signature ------------------------------------
    const signingKey = Deno.env.get('MAILGUN_WEBHOOK_SIGNING_KEY');
    if (!signingKey) {
      console.error('MAILGUN_WEBHOOK_SIGNING_KEY missing.');
      return jsonResponse({ ok: false, error: 'Server misconfigured.' }, 500);
    }
    const timestamp = String(form.get('timestamp') || '');
    const token = String(form.get('token') || '');
    const signature = String(form.get('signature') || '');
    if (!timestamp || !token || !signature) {
      return jsonResponse({ ok: false, error: 'Missing signature fields.' }, 401);
    }
    // Reject signatures older than 15 minutes (Mailgun docs recommend this).
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 900) {
      return jsonResponse({ ok: false, error: 'Stale timestamp.' }, 401);
    }
    const expected = await hmacSha256Hex(signingKey, timestamp + token);
    if (!timingSafeEqual(expected, signature)) {
      return jsonResponse({ ok: false, error: 'Bad signature.' }, 401);
    }

    // -------- Resolve the conversation from the recipient -----------------
    // Mailgun's `recipient` field is the matched alias.
    const recipient = String(form.get('recipient') || '').toLowerCase();
    const convMatch = recipient.match(/^reply\+([0-9a-f-]{36})@/i);
    if (!convMatch) {
      return jsonResponse({ ok: true, skipped: 'recipient not a conversation reply' });
    }
    const conversationId = convMatch[1];

    const sb = adminClient();
    const { data: conv } = await sb
      .from('conversations')
      .select('id, submission_id, status')
      .eq('id', conversationId)
      .maybeSingle();
    if (!conv) {
      // Send a bounce later if we want; for now just log and 200 so Mailgun
      // doesn't retry forever.
      console.warn('Inbound for unknown conversation', conversationId);
      return jsonResponse({ ok: true, skipped: 'unknown conversation' });
    }

    // -------- Dedupe on Message-Id ----------------------------------------
    const inboundMessageId = String(form.get('Message-Id') || form.get('message-id') || '').trim() || null;
    if (inboundMessageId) {
      const { data: existing } = await sb
        .from('messages')
        .select('id')
        .eq('inbound_message_id', inboundMessageId)
        .maybeSingle();
      if (existing) {
        return jsonResponse({ ok: true, skipped: 'duplicate Message-Id' });
      }
    }

    // -------- Resolve sender role -----------------------------------------
    const fromRaw = String(form.get('from') || '');
    const fromEmail = extractEmail(fromRaw);
    const fromName = extractName(fromRaw);

    let senderRole: 'admin' | 'studio' = 'studio';
    let senderAdminId: string | null = null;
    if (fromEmail) {
      const { data: admin } = await sb
        .from('admin_users')
        .select('id, email, name')
        .ilike('email', fromEmail)
        .eq('is_active', true)
        .maybeSingle();
      if (admin) {
        senderRole = 'admin';
        senderAdminId = admin.id;
      }
    }

    // -------- Pull body (prefer Mailgun's quoted-reply-stripped version) --
    const strippedText = String(form.get('stripped-text') || '').trim();
    const strippedHtml = String(form.get('stripped-html') || '').trim();
    const fullText = String(form.get('body-plain') || '').trim();
    const fullHtml = String(form.get('body-html') || '').trim();
    const bodyText = strippedText || fullText;
    const bodyHtml = strippedHtml || fullHtml || null;
    if (!bodyText && !bodyHtml) {
      return jsonResponse({ ok: true, skipped: 'empty body' });
    }

    // In-Reply-To linkage for our records (we don't strictly need it but it's
    // useful for debugging thread breakage).
    const inReplyTo = String(form.get('In-Reply-To') || form.get('in-reply-to') || '').trim() || null;

    // -------- Insert the message ------------------------------------------
    // Email replies are always studio-visible. Internal notes are a web-UI
    // feature only — admins replying via email post a studio-visible reply
    // (we tell them so in the notification email).
    const { data: inserted, error: insErr } = await sb
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_role: senderRole,
        visibility: 'studio',
        sender_admin_id: senderAdminId,
        sender_email: fromEmail,
        sender_name: fromName || (senderRole === 'admin' ? 'Admin' : null),
        body_text: bodyText || null,
        body_html: bodyHtml,
        inbound_message_id: inboundMessageId,
        in_reply_to: inReplyTo,
      })
      .select('id')
      .single();
    if (insErr || !inserted) throw insErr || new Error('Insert failed.');

    // -------- Attachments -------------------------------------------------
    // Mailgun packs attachments as fields `attachment-1`, `attachment-2`, …
    // Each is a File blob with name + type.
    const tooLarge: string[] = [];
    const attachmentCount = Number(form.get('attachment-count') || 0);
    for (let i = 1; i <= attachmentCount; i++) {
      const file = form.get(`attachment-${i}`);
      if (!(file instanceof File)) continue;
      if (file.size > ATTACHMENT_MAX_BYTES) {
        tooLarge.push(file.name);
        continue;
      }
      const safeName = file.name.replace(/[^\w.\-]+/g, '_').slice(0, 120);
      const storagePath = `${conversationId}/${inserted.id}/${i}-${safeName}`;
      const buf = new Uint8Array(await file.arrayBuffer());
      const { error: upErr } = await sb.storage
        .from(ATTACHMENT_BUCKET)
        .upload(storagePath, buf, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (upErr) {
        console.error('Attachment upload failed:', upErr);
        continue;
      }
      await sb.from('message_attachments').insert({
        message_id: inserted.id,
        storage_path: storagePath,
        filename: safeName,
        content_type: file.type || null,
        size_bytes: file.size,
      });
    }

    // If anything was rejected for size, append a system note explaining.
    if (tooLarge.length) {
      await sb.from('messages').insert({
        conversation_id: conversationId,
        sender_role: 'system',
        visibility: 'studio',
        body_text: `Note: ${tooLarge.length} attachment${tooLarge.length === 1 ? ' was' : 's were'} skipped because they exceed the 10 MB per-file limit (${tooLarge.join(', ')}). Please send a smaller version or a download link.`,
      });
    }

    return jsonResponse({ ok: true, message_id: inserted.id, attachments_skipped: tooLarge.length });
  } catch (err) {
    console.error('inbound-message error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function extractEmail(s: string): string | null {
  if (!s) return null;
  const angle = s.match(/<([^>]+)>/);
  const raw = angle ? angle[1] : s;
  const m = raw.match(/[^\s<>"@]+@[^\s<>"@]+/);
  return m ? m[0].toLowerCase() : null;
}

function extractName(s: string): string | null {
  if (!s) return null;
  const angle = s.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>/);
  if (angle) return angle[1].trim();
  return null;
}
