// Auto-save and final submit for the draft submission. Authorised by the
// session_token issued by verify-otp. The same function handles both partial
// saves (status stays 'draft') and final submission (status -> 'submitted').
//
// On final submission, sends the studio confirmation and admin notification
// emails inline rather than relying on a database webhook, so the same flow
// runs whether the row was inserted directly or evolved from a draft.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { submissionConfirmation, adminNewSubmission } from '../_shared/email-templates.ts';

const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL: Record<string, string> = { dfy: 'Done-For-You', guided: 'Guided' };

// Whitelist of columns the client may write. Server-only fields are excluded.
const ALLOWED_FIELDS = new Set([
  'plan','setup_type','studio_name','legal_name','country','timezone','studio_type',
  'address','website','support_url','first_name','last_name','contact_phone','role',
  'studiolab_email','logo_url','primary_colour','secondary_colour','sign_off',
  'email_tone','footer_notes','studio_description','from_name','reply_email',
  'custom_domain','email_domain','dns_access','sms_type','area_code','port_number',
  'sms_tone','lead_sources','kb_profile','kb_classes',
  'kb_pricing','kb_price_quoting','kb_policies','kb_events','kb_faqs','kb_restricted',
  'kb_tone','voice_hours','voice_escalate','extra_notes',
]);

function pickAllowed(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (ALLOWED_FIELDS.has(k)) out[k] = v === '' ? null : v;
  }
  return out;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json();
    const { session_token, payload, last_step_completed, finalize } = body;
    if (!session_token || typeof session_token !== 'string') {
      return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);
    }

    const sb = adminClient();
    const sessionHash = await sha256Hex(session_token);

    const { data: row, error: lookupErr } = await sb.from('submissions')
      .select('*')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();

    if (lookupErr) throw lookupErr;
    if (!row) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!row.session_expires_at || new Date(row.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired. Please verify your email again.' }, 401);
    }

    const update: Record<string, unknown> = {
      ...pickAllowed(payload || {}),
      last_saved_at: new Date().toISOString(),
    };
    if (typeof last_step_completed === 'number') update.last_step_completed = last_step_completed;

    // Never let the client clear the email or change the verification anchor
    delete (update as Record<string, unknown>).contact_email;

    if (finalize === true) {
      update.status = 'submitted';
      update.submitted_at = new Date().toISOString();
      // Invalidate the session so the studio can't keep editing after submit.
      update.session_token_hash = null;
      update.session_expires_at = null;
    }

    const { data: saved, error: updErr } = await sb.from('submissions')
      .update(update)
      .eq('id', row.id)
      .select('*')
      .single();
    if (updErr) throw updErr;

    // On finalize, fan out emails + activity log inline (replaces the webhook path)
    if (finalize === true) {
      const ref = String(saved.id).replace(/-/g, '').substring(0, 8).toUpperCase();
      const finalRow = { ...row, ...update };

      try {
        const t = submissionConfirmation({ studioName: finalRow.studio_name || 'there', ref });
        await sendEmail({
          to: row.contact_email,
          subject: t.subject,
          html: t.html,
          replyTo: 'growth@studiolabgrowth.com',
        });
      } catch (e) { console.error('confirmation email failed:', e); }

      try {
        const { data: admins } = await sb.from('admin_users').select('email').eq('is_active', true);
        if (admins && admins.length) {
          const appUrl = Deno.env.get('ADMIN_APP_URL') || '';
          const t = adminNewSubmission({
            studioName: finalRow.studio_name || '(no name)',
            plan: PLAN_LABEL[finalRow.plan as string] || (finalRow.plan as string),
            setup: SETUP_LABEL[finalRow.setup_type as string] || (finalRow.setup_type as string),
            adminUrl: `${appUrl}?id=${saved.id}`,
          });
          await sendEmail({ to: admins.map((a) => a.email), subject: t.subject, html: t.html });
        }
      } catch (e) { console.error('admin notification failed:', e); }

      try {
        await sb.from('activity_log').insert({
          submission_id: saved.id,
          action: 'submitted',
          actor: row.contact_email || 'studio',
          details: { plan: finalRow.plan, setup_type: finalRow.setup_type, region: row.region },
        });
      } catch (e) { console.error('activity log insert failed:', e); }

      return jsonResponse({ ok: true, finalized: true, submission_id: saved.id, ref });
    }

    // Strip server-only field before returning
    const { session_token_hash: _h, ...safe } = saved;
    return jsonResponse({ ok: true, finalized: false, last_saved_at: saved.last_saved_at, submission: safe });
  } catch (err) {
    console.error('save-draft error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
