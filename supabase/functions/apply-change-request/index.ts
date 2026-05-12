// Anon-invoked. Applies values to the submission, marks the change request
// completed, logs activity, and triggers the on-change-completed notification.
//
// Body: { token: string, values: Record<string, unknown> }

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { changeCompletedAdmin } from '../_shared/email-templates.ts';

// Allowlist of columns that may be updated via the magic-link flow. Kept in
// sync with FIELDS in js/update.js.
const ALLOWED = new Set([
  'studio_name','legal_name','country','timezone','studio_type','address','website','support_url',
  'first_name','last_name','contact_email','contact_phone','role','studiolab_email',
  'primary_colour','secondary_colour','sign_off','email_tone','footer_notes','studio_description',
  'from_name','reply_email','email_domain','dns_access',
  'sms_type','area_code','port_number','sms_tone',
  'kb_profile','kb_classes','kb_pricing','kb_policies','kb_events','kb_restricted','kb_tone',
  'voice_hours','voice_escalate','extra_notes',
]);

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const { token, values } = await req.json();
    if (!token || typeof token !== 'string' || !values || typeof values !== 'object') {
      return jsonResponse({ ok: false, error: 'token and values required.' }, 400);
    }

    const sb = adminClient();
    const hash = await sha256Hex(token);
    const { data: cr } = await sb
      .from('change_requests')
      .select('id, submission_id, fields, status, token_expires_at')
      .eq('token_hash', hash)
      .single();

    if (!cr) return jsonResponse({ ok: false, error: 'Not found.' }, 404);
    if (cr.status === 'completed') return jsonResponse({ ok: false, error: 'Already completed.' }, 410);
    if (cr.status === 'expired' || new Date(cr.token_expires_at).getTime() < Date.now()) {
      await sb.from('change_requests').update({ status: 'expired' }).eq('id', cr.id);
      return jsonResponse({ ok: false, error: 'Link expired.' }, 410);
    }

    // Build the update from values, scoped to the requested fields AND the allowlist.
    const requested = new Set(cr.fields as string[]);
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!requested.has(k) || !ALLOWED.has(k)) continue;
      patch[k] = v === '' ? null : v;
    }
    if (Object.keys(patch).length === 0) {
      return jsonResponse({ ok: false, error: 'No valid fields supplied.' }, 400);
    }

    const { error: upErr } = await sb.from('submissions').update(patch).eq('id', cr.submission_id);
    if (upErr) throw upErr;

    const completedAt = new Date().toISOString();
    await sb.from('change_requests').update({
      status: 'completed',
      completed_at: completedAt,
      updated_values: patch,
    }).eq('id', cr.id);

    // Bump submission status back to 'in_review' so an admin can pick it up.
    await sb.from('submissions').update({ status: 'in_review' }).eq('id', cr.submission_id);

    await sb.from('activity_log').insert({
      submission_id: cr.submission_id,
      action: 'change_request_completed',
      actor: 'studio',
      details: { change_request_id: cr.id, fields_updated: Object.keys(patch) },
    });

    // Notify admins (best-effort; do not fail the request if email fails).
    try {
      const { data: sub } = await sb.from('submissions').select('studio_name').eq('id', cr.submission_id).single();
      const { data: admins } = await sb.from('admin_users').select('email').eq('is_active', true);
      if (admins && admins.length) {
        const appUrl = Deno.env.get('ADMIN_APP_URL') || '';
        const t = changeCompletedAdmin({
          studioName: sub?.studio_name || 'A studio',
          adminUrl: `${appUrl}?id=${cr.submission_id}`,
          fields: Object.keys(patch),
        });
        await sendEmail({ to: admins.map((a) => a.email), subject: t.subject, html: t.html });
      }
    } catch (e) {
      console.warn('Admin notification email failed:', e);
    }

    // If this submission has an active assignment that's already received a
    // handoff, auto-resend with the updated values flagged. Server-to-server
    // call into send-handoff with the service role token as auth bypass.
    try {
      const { data: activeAsgn } = await sb.from('submission_assignments')
        .select('id, last_sent_at')
        .eq('submission_id', cr.submission_id)
        .in('status', ['assigned','in_progress','needs_recheck'])
        .order('assigned_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeAsgn?.last_sent_at) {
        const fnUrl = Deno.env.get('SUPABASE_URL') + '/functions/v1/send-handoff';
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        await fetch(fnUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
          body: JSON.stringify({
            submission_id: cr.submission_id,
            __internal_skip_auth: serviceKey,
          }),
        });
      }
    } catch (e) {
      console.warn('Handoff auto-resend failed:', e);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('apply-change-request error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
