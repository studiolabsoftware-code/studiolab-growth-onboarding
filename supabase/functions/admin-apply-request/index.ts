// Admin applies a service request after the linked quote has been paid.
// Flips the locked submission fields (plan or setup_type) according to
// the request kind, marks the request 'applied', posts a system event
// into the inbox, emails the studio.
//
// Guard rails:
//   * Caller must be owner or admin (VAs can't touch billing-impacting
//     state; same rule as admin-mark-active).
//   * Request must be in 'paid' status -- applying an unpaid request
//     would put us in the awkward position of giving away the upgrade
//     without payment landing.
//   * Custom add-on and 'other' kinds have no structured target, so the
//     "apply" action just closes the request out -- the actual delivery
//     happens via separate workstreams that admin manages out-of-band.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { studioRequestApplied } from '../_shared/email-templates.ts';
import { postSystemMessage } from '../_shared/inbox.ts';

const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL: Record<string, string> = { dfy: 'Done-For-You', guided: 'Guided self-setup' };

function describe(req: Record<string, unknown>, currentPlan: string, currentSetup: string): string {
  const k = String(req.kind);
  if (k === 'plan_upgrade') {
    return `Plan upgraded to ${PLAN_LABEL[String(req.target_plan)] || req.target_plan}`;
  }
  if (k === 'setup_change') {
    return `Setup switched to ${SETUP_LABEL[String(req.target_setup_type)] || req.target_setup_type}`;
  }
  if (k === 'custom_addon') return 'Custom add-on delivered';
  return 'Request actioned';
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Not authorised.' }, 401);
    if (caller.role !== 'owner' && caller.role !== 'admin') {
      return jsonResponse({ ok: false, error: 'Only owners or admins can apply requests.' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const requestId = String(body.request_id || '').trim();
    if (!requestId) return jsonResponse({ ok: false, error: 'request_id required.' }, 400);

    const sb = adminClient();
    const { data: request, error: lookupErr } = await sb.from('service_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!request) return jsonResponse({ ok: false, error: 'Request not found.' }, 404);
    if (request.status !== 'paid') {
      return jsonResponse({
        ok: false,
        error: `Can only apply a paid request. This one is ${request.status}.`,
        code: 'wrong_status',
      }, 409);
    }

    const { data: sub, error: subErr } = await sb.from('submissions')
      .select('id, plan, setup_type, studio_name, contact_email')
      .eq('id', request.submission_id)
      .single();
    if (subErr) throw subErr;

    // Flip the locked fields per the request kind. plan_upgrade and
    // setup_change carry their target; custom_addon and other don't
    // mutate the submission but still close the request out.
    const subPatch: Record<string, unknown> = {};
    if (request.kind === 'plan_upgrade' && request.target_plan) {
      subPatch.plan = request.target_plan;
    } else if (request.kind === 'setup_change' && request.target_setup_type) {
      subPatch.setup_type = request.target_setup_type;
    }
    if (Object.keys(subPatch).length) {
      const { error: updErr } = await sb.from('submissions').update(subPatch).eq('id', sub.id);
      if (updErr) throw updErr;
    }

    const appliedAt = new Date().toISOString();
    const { error: reqErr } = await sb.from('service_requests')
      .update({ status: 'applied', applied_at: appliedAt, applied_by: caller.email || caller.name })
      .eq('id', requestId);
    if (reqErr) throw reqErr;

    const summary = describe(request, sub.plan, sub.setup_type);

    // Activity log + inbox system event so the change has audit cover
    // and the studio sees it in their conversation thread alongside
    // the email.
    try {
      await sb.from('activity_log').insert({
        submission_id: sub.id,
        action: 'service_request_applied',
        actor: caller.email || caller.name || 'admin',
        details: {
          request_id: requestId,
          kind: request.kind,
          target_plan: request.target_plan || null,
          target_setup_type: request.target_setup_type || null,
          patch: subPatch,
        },
      });
    } catch (e) { console.error('activity log insert failed:', e); }

    try {
      await postSystemMessage(sb, sub.id, sub.studio_name, summary + '. Your account now reflects this change on our side.');
    } catch (e) { console.error('system message failed:', e); }

    try {
      const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
      const isLive = (settings?.stripe_mode || 'test') === 'live';
      const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';
      const sendGated = createGatedSender({ isLive, testRecipient });
      const appUrl = Deno.env.get('APP_URL') || '';
      const accountUrl = appUrl ? `${appUrl}/account.html` : null;
      const tpl = studioRequestApplied({
        studioName: sub.studio_name || 'there',
        summary,
        accountUrl,
      });
      if (sub.contact_email) {
        await sendGated({
          to: sub.contact_email,
          subject: tpl.subject,
          html: tpl.html,
          replyTo: 'info@studiolabsoftware.com',
          intent: 'studio request applied',
        });
      }
    } catch (e) { console.error('applied email failed:', e); }

    return jsonResponse({ ok: true, applied_at: appliedAt, submission_patch: subPatch });
  } catch (err) {
    console.error('admin-apply-request error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
