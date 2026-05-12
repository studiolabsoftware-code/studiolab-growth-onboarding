// Triggered by a Supabase Database Webhook on INSERT to submissions.
// Sends a confirmation email to the studio and a notification to all admins,
// and inserts a 'submitted' row in activity_log.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { submissionConfirmation, adminNewSubmission } from '../_shared/email-templates.ts';

const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL: Record<string, string> = { dfy: 'Done-For-You', guided: 'Guided' };

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const payload = await req.json();
    // Supabase webhook shape: { type, table, record, schema, old_record }
    const row = payload.record || payload;
    if (!row || !row.id) return jsonResponse({ ok: false, error: 'No record.' }, 400);

    // Drafts created by verify-otp must NOT trigger the confirmation/admin
    // emails. The save-draft Edge Function handles those inline at the moment
    // of finalization. Bail early so this webhook is a no-op for drafts.
    if (row.status === 'draft') {
      return jsonResponse({ ok: true, skipped: 'draft' });
    }

    const sb = adminClient();
    const appUrl = Deno.env.get('ADMIN_APP_URL') || '';
    const ref = String(row.id).replace(/-/g, '').substring(0, 8).toUpperCase();

    // Confirmation to studio
    if (row.contact_email) {
      const t = submissionConfirmation({ studioName: row.studio_name || 'there', ref });
      await sendEmail({ to: row.contact_email, subject: t.subject, html: t.html, replyTo: 'growth@studiolabgrowth.com' });
    }

    // Notify all active admins
    const { data: admins } = await sb.from('admin_users').select('email').eq('is_active', true);
    if (admins && admins.length) {
      const t = adminNewSubmission({
        studioName: row.studio_name || '(no name)',
        plan: PLAN_LABEL[row.plan] || row.plan,
        setup: SETUP_LABEL[row.setup_type] || row.setup_type,
        adminUrl: `${appUrl}?id=${row.id}`,
      });
      await sendEmail({ to: admins.map((a) => a.email), subject: t.subject, html: t.html });
    }

    await sb.from('activity_log').insert({
      submission_id: row.id,
      action: 'submitted',
      actor: row.contact_email || 'studio',
      details: { plan: row.plan, setup_type: row.setup_type },
    });

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('on-submission error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
