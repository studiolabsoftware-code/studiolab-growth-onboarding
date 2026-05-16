// Triggered by a Supabase Database Webhook on INSERT to public.messages.
//
// Sends a Mailgun notification to the appropriate side(s):
//   - admin → studio (visibility=studio): email the studio contact
//   - studio → admin (visibility=studio): email subscribed admins
//   - admin → admin (visibility=internal): email subscribed admins, excluding
//     the author. The studio is never notified about internal notes.
//   - system: no email, in-thread only.
//
// Sets Reply-To = reply+<conv_id>@inbox.studiolabgrowth.com so replies route
// back to the inbound-message function. Sets Message-Id / In-Reply-To /
// References so email clients thread correctly.
//
// Webhook payload shape (Supabase): { type, table, record, schema, old_record }

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import {
  resolveAdminRecipients,
  replyAddress,
  mintMessageId,
  buildThreadingHeaders,
  threadSubject,
  ensureStudioToken,
} from '../_shared/inbox.ts';
import { inboxMessageEmail } from '../_shared/email-templates.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const payload = await req.json();
    const msg = payload.record || payload;
    if (!msg || !msg.id) return jsonResponse({ ok: false, error: 'No record.' }, 400);

    // System events never send email.
    if (msg.sender_role === 'system') {
      return jsonResponse({ ok: true, skipped: 'system' });
    }

    const sb = adminClient();

    // Pull the conversation + its studio context.
    const { data: conv, error: convErr } = await sb
      .from('conversations')
      .select('id, submission_id, subject, created_at')
      .eq('id', msg.conversation_id)
      .single();
    if (convErr || !conv) throw convErr || new Error('Conversation not found.');

    const { data: sub } = await sb
      .from('submissions')
      .select('id, studio_name, contact_email')
      .eq('id', conv.submission_id)
      .single();
    if (!sub) throw new Error('Submission not found.');

    // Threading: find the most recent prior message with an outbound or
    // inbound Message-Id so this email can be linked as a reply to it.
    const { data: prior } = await sb
      .from('messages')
      .select('outbound_message_id, inbound_message_id')
      .eq('conversation_id', conv.id)
      .lt('created_at', msg.created_at)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const parentMessageId = prior?.outbound_message_id || prior?.inbound_message_id || null;

    // Mint our outbound Message-Id and persist it on this message row so the
    // next reply (web or email) can chain off it.
    const selfMessageId = mintMessageId(msg.id);
    await sb.from('messages')
      .update({ outbound_message_id: selfMessageId })
      .eq('id', msg.id);

    const headers = buildThreadingHeaders({
      selfMessageId,
      parentMessageId,
    });
    const reply = replyAddress(conv.id);
    const appUrl = Deno.env.get('APP_URL') || '';
    const adminAppUrl = Deno.env.get('ADMIN_APP_URL') || appUrl;
    const studioName = sub.studio_name || 'your studio';

    // --------------------------------------------------------------------
    // Case 1: admin posts a studio-visible message → email the studio
    // --------------------------------------------------------------------
    if (msg.sender_role === 'admin' && msg.visibility === 'studio') {
      if (!sub.contact_email) {
        return jsonResponse({ ok: true, skipped: 'no contact email' });
      }
      // Mint (or reuse) the stable studio token, then build a portal deep
      // link the studio can use to view the full thread, attach files, etc.
      const studioToken = await ensureStudioToken(sb, conv.id);
      const portalUrl = `${appUrl}/portal.html?conv=${conv.id}&t=${studioToken}`;
      const portalNote = `<p style="margin:24px 0 0;">Reply to this email, or open the full conversation in your studio portal:</p>
        <p style="margin:8px 0 0;"><a href="${portalUrl}" style="display:inline-block;background:#4A3F8A;color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:999px;font-size:13px;">Open studio portal</a></p>
        <p style="margin:14px 0 0;color:#6B6E8B;font-size:11px;">The portal link is private to your conversation. Forward it to a colleague if they need to respond on your behalf.</p>`;

      const t = inboxMessageEmail({
        studioName,
        senderName: msg.sender_name || 'StudioLAB Growth',
        bodyHtml: msg.body_html || escapeHtml(msg.body_text || ''),
        footerHtml: portalNote,
        previewText: stripToPreview(msg.body_text || ''),
      });
      await sendEmail({
        to: sub.contact_email,
        subject: threadSubject(studioName, conv.subject, !!parentMessageId),
        html: t.html,
        replyTo: reply,
        headers,
      });
      return jsonResponse({ ok: true, sent_to: 'studio' });
    }

    // --------------------------------------------------------------------
    // Case 2: studio posts → email subscribed admins
    // Case 3: admin internal note → email subscribed admins except author
    // --------------------------------------------------------------------
    const isInternalNote = msg.sender_role === 'admin' && msg.visibility === 'internal';
    const excludeId = msg.sender_role === 'admin' ? msg.sender_admin_id : null;
    let recipients = await resolveAdminRecipients(sb, conv.id, conv.submission_id, excludeId);
    // Test-mode filter: collapse the admin fanout to owners only so VAs
    // aren't pinged for sandbox threads. Live mode keeps the existing
    // assignment + subscription logic intact.
    const { data: pmSettings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
    const isLive = (pmSettings?.stripe_mode || 'test') === 'live';
    if (!isLive) {
      recipients = recipients.filter((r) => r.role === 'owner');
    }
    if (recipients.length === 0) {
      return jsonResponse({ ok: true, skipped: 'no subscribed admins' });
    }

    const adminLink = `${adminAppUrl}?id=${conv.submission_id}#inbox`;
    const noteBanner = isInternalNote
      ? `<div style="background:#FFF7E6;border:1px solid #F2D58A;border-radius:8px;padding:10px 14px;margin:0 0 16px;font-size:13px;color:#7A5A00;"><strong>Internal note</strong> — not visible to the studio. Replying via email will post a studio-visible reply; use the dashboard for further internal notes.</div>`
      : '';
    const senderLabel = isInternalNote
      ? `${msg.sender_name || 'Admin'} (internal note)`
      : (msg.sender_name || sub.contact_email || 'Studio');

    const t = inboxMessageEmail({
      studioName,
      senderName: senderLabel,
      bodyHtml: (noteBanner) + (msg.body_html || escapeHtml(msg.body_text || '')),
      footerHtml: `<p style="margin:24px 0 0;">Open in dashboard: <a href="${adminLink}">${studioName} thread</a></p>`,
      previewText: stripToPreview(msg.body_text || ''),
    });

    await sendEmail({
      to: recipients.map((r) => r.email),
      subject: threadSubject(studioName, conv.subject, !!parentMessageId),
      html: t.html,
      // Admins also reply by email — the inbound function recognises them
      // via admin_users membership.
      replyTo: reply,
      headers,
    });

    return jsonResponse({ ok: true, sent_to: 'admins', count: recipients.length });
  } catch (err) {
    console.error('notify-new-message error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function stripToPreview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 140);
}
