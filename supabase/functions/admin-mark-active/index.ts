// Admin-only: flip a submission to status='active' once the studio's GHL
// account is live. Records activated_at, posts a system event into the
// inbox thread, emails the studio with the activation notice, and writes
// an activity_log row for audit.
//
// Idempotent: calling on an already-active submission re-confirms but
// does not re-send the activation email (which would spam the studio).
//
// Auth: caller must be an authenticated owner or admin. VAs cannot
// activate accounts — this is a deliberate scope guard since activation
// is the moment the studio becomes a paying live customer on GHL.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { studioActivated } from '../_shared/email-templates.ts';
import { postSystemMessage } from '../_shared/inbox.ts';
import { sendIfAllowed } from '../_shared/studio-email.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Not authorised.' }, 401);
    if (caller.role !== 'owner' && caller.role !== 'admin') {
      return jsonResponse({ ok: false, error: 'Only owners or admins can mark accounts active.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const submissionId = String(body.submission_id || '').trim();
    if (!submissionId) return jsonResponse({ ok: false, error: 'submission_id required.' }, 400);

    const sb = adminClient();
    const { data: existing, error: lookupErr } = await sb.from('submissions')
      .select('id, status, studio_name, contact_email, activated_at')
      .eq('id', submissionId)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!existing) return jsonResponse({ ok: false, error: 'Submission not found.' }, 404);

    // Idempotency guard — if already active we just confirm and skip the
    // side effects. Saves an accidental double-tap from spamming the studio.
    if (existing.status === 'active') {
      return jsonResponse({
        ok: true,
        already_active: true,
        activated_at: existing.activated_at,
      });
    }

    const activatedAt = new Date().toISOString();
    const { data: saved, error: updErr } = await sb.from('submissions')
      .update({ status: 'active', activated_at: activatedAt })
      .eq('id', submissionId)
      .select('id, studio_name, contact_email, activated_at')
      .single();
    if (updErr) throw updErr;

    // Activity log — record who flipped the switch so we have an audit
    // trail even if the email send later turns out to have bounced.
    try {
      await sb.from('activity_log').insert({
        submission_id: saved.id,
        action: 'marked_active',
        actor: caller.email || caller.name || 'admin',
        details: { activated_at: activatedAt },
      });
    } catch (e) { console.error('activity log insert failed:', e); }

    // System event into the inbox — gives the studio an in-thread marker
    // beyond the email, and matches the pattern other status transitions
    // already use (KB confirmed, payment received, etc.).
    try {
      await postSystemMessage(
        sb,
        saved.id,
        saved.studio_name,
        `Your StudioLAB Growth account is now active. A welcome email with your platform login details will follow.`,
      );
    } catch (e) { console.error('system message insert failed:', e); }

    // Studio activation email — mode-gated. Test mode redirects to the
    // test inbox; live mode goes to the studio's contact_email.
    try {
      const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
      const isLive = (settings?.stripe_mode || 'test') === 'live';
      const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';
      const sendGated = createGatedSender({ isLive, testRecipient });
      const appUrl = Deno.env.get('APP_URL') || '';
      const accountUrl = appUrl ? `${appUrl}/account.html` : null;
      const tpl = studioActivated({
        studioName: saved.studio_name || 'there',
        accountUrl,
      });
      if (saved.contact_email) {
        await sendIfAllowed({
          sb,
          submissionId: saved.id,
          sender: sendGated,
          email: {
            to: saved.contact_email,
            subject: tpl.subject,
            html: tpl.html,
            replyTo: 'info@studiolabsoftware.com',
            intent: 'studio activated',
          },
        });
      }
    } catch (e) { console.error('activation email failed:', e); }

    return jsonResponse({
      ok: true,
      already_active: false,
      activated_at: activatedAt,
    });
  } catch (err) {
    console.error('admin-mark-active error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
