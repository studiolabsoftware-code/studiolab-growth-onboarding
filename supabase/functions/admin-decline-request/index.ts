// Admin declines a service request. Captures the reason (which the
// studio sees verbatim), posts a system event into the inbox, emails
// the studio with the warm-no template.
//
// Auth: owner or admin. VAs can't decline because the decision often
// has commercial implications (custom add-ons, plan changes) we'd
// rather route through senior eyes.
//
// Idempotency: declining an already-declined request just re-confirms
// the existing reason. We do NOT re-fire the system event or email --
// that would be confusing for the studio.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { studioRequestDeclined } from '../_shared/email-templates.ts';
import { postSystemMessage } from '../_shared/inbox.ts';
import { sendIfAllowed } from '../_shared/studio-email.ts';

const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL: Record<string, string> = { dfy: 'Done-For-You', guided: 'Guided self-setup' };

function summarise(req: Record<string, unknown>, currentPlan: string, currentSetup: string): string {
  const k = String(req.kind);
  if (k === 'plan_upgrade') {
    return `Plan upgrade to ${PLAN_LABEL[String(req.target_plan)] || req.target_plan}`;
  }
  if (k === 'setup_change') {
    return `Setup change to ${SETUP_LABEL[String(req.target_setup_type)] || req.target_setup_type}`;
  }
  if (k === 'custom_addon') return 'Custom add-on';
  return 'General request';
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Not authorised.' }, 401);
    if (caller.role !== 'owner' && caller.role !== 'admin') {
      return jsonResponse({ ok: false, error: 'Only owners or admins can decline requests.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const requestId = String(body.request_id || '').trim();
    const reason = String(body.reason || '').trim();
    if (!requestId) return jsonResponse({ ok: false, error: 'request_id required.' }, 400);
    if (!reason) return jsonResponse({ ok: false, error: 'A short reason is required so the studio understands the decision.' }, 400);
    if (reason.length > 2000) return jsonResponse({ ok: false, error: 'Reason is too long (max 2,000 characters).' }, 400);

    const sb = adminClient();
    const { data: request, error: lookupErr } = await sb.from('service_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!request) return jsonResponse({ ok: false, error: 'Request not found.' }, 404);

    if (request.status === 'declined') {
      // Idempotent re-confirm. Update the reason if it changed but don't
      // re-fire downstream events.
      if (reason !== request.declined_reason) {
        await sb.from('service_requests').update({ declined_reason: reason }).eq('id', requestId);
      }
      return jsonResponse({ ok: true, already_declined: true });
    }
    if (request.status === 'applied') {
      return jsonResponse({ ok: false, error: 'Cannot decline a request that has already been applied.', code: 'already_applied' }, 409);
    }

    const { data: sub, error: subErr } = await sb.from('submissions')
      .select('id, plan, setup_type, studio_name, contact_email')
      .eq('id', request.submission_id)
      .single();
    if (subErr) throw subErr;

    const { error: updErr } = await sb.from('service_requests')
      .update({ status: 'declined', declined_reason: reason })
      .eq('id', requestId);
    if (updErr) throw updErr;

    const summary = summarise(request, sub.plan, sub.setup_type);

    try {
      await sb.from('activity_log').insert({
        submission_id: sub.id,
        action: 'service_request_declined',
        actor: caller.email || caller.name || 'admin',
        details: { request_id: requestId, kind: request.kind, reason },
      });
    } catch (e) { console.error('activity log insert failed:', e); }

    try {
      await postSystemMessage(
        sb,
        sub.id,
        sub.studio_name,
        `We're not able to take on the request "${summary}" right now. Reason: ${reason}`,
      );
    } catch (e) { console.error('system message failed:', e); }

    try {
      const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
      const isLive = (settings?.stripe_mode || 'test') === 'live';
      const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';
      const sendGated = createGatedSender({ isLive, testRecipient });
      const appUrl = Deno.env.get('APP_URL') || '';
      const accountUrl = appUrl ? `${appUrl}/account.html` : null;
      const tpl = studioRequestDeclined({
        studioName: sub.studio_name || 'there',
        summary,
        reason,
        accountUrl,
      });
      if (sub.contact_email) {
        await sendIfAllowed({
          sb,
          submissionId: sub.id,
          sender: sendGated,
          email: {
            to: sub.contact_email,
            subject: tpl.subject,
            html: tpl.html,
            replyTo: 'info@studiolabsoftware.com',
            intent: 'studio request declined',
          },
        });
      }
    } catch (e) { console.error('decline email failed:', e); }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error('admin-decline-request error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
