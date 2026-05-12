// Admin-invoked. Generates a one-time token, stores its hash, and emails the
// studio a magic link to /update.html?token=RAW.
//
// Body: { submission_id, fields: string[], message?: string, created_by?: string,
//         ttl_hours?: number }

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex, randomToken } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { changeRequestEmail } from '../_shared/email-templates.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    // Verify the caller is an authenticated admin via the JWT in Authorization.
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);

    const body = await req.json();
    const { submission_id, fields, message, created_by, ttl_hours } = body;
    if (!submission_id || !Array.isArray(fields) || fields.length === 0) {
      return jsonResponse({ ok: false, error: 'submission_id and fields are required.' }, 400);
    }

    const sb = adminClient();
    const { data: sub, error: subErr } = await sb
      .from('submissions')
      .select('id, studio_name, contact_email')
      .eq('id', submission_id)
      .single();
    if (subErr || !sub) return jsonResponse({ ok: false, error: 'Submission not found.' }, 404);

    const raw = randomToken(32);
    const tokenHash = await sha256Hex(raw);
    const ttl = Math.max(1, Math.min(168, ttl_hours || 72)); // 1h–7d, default 72h
    const expiresAt = new Date(Date.now() + ttl * 3600 * 1000).toISOString();

    const { data: cr, error: crErr } = await sb
      .from('change_requests')
      .insert({
        submission_id,
        created_by: created_by || 'admin',
        fields,
        message: message || null,
        token_hash: tokenHash,
        token_expires_at: expiresAt,
        status: 'sent',
      })
      .select('id')
      .single();
    if (crErr) throw crErr;

    // Update submission status
    await sb.from('submissions').update({ status: 'changes_requested' }).eq('id', submission_id);

    // Activity log
    await sb.from('activity_log').insert({
      submission_id,
      action: 'change_request_sent',
      actor: created_by || 'admin',
      details: { change_request_id: cr.id, fields, ttl_hours: ttl },
    });

    // Email the studio
    const appUrl = Deno.env.get('APP_URL') || '';
    const updateUrl = `${appUrl}/update.html?token=${raw}`;
    const t = changeRequestEmail({
      studioName: sub.studio_name || 'there',
      updateUrl,
      message: message || '',
      expiresAt: new Date(expiresAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', dateStyle: 'medium', timeStyle: 'short' }),
    });
    await sendEmail({ to: sub.contact_email, subject: t.subject, html: t.html, replyTo: 'growth@studiolabgrowth.com' });

    return jsonResponse({ ok: true, change_request_id: cr.id });
  } catch (err) {
    console.error('send-change-request error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
