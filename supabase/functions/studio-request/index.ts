// Studio service request entry point. Called from account.html when a
// studio asks to upgrade their plan, switch setup type, add a custom
// service, or raise an "other" request. Stays deliberately thin:
// validate, persist, notify admin, return.
//
// Auth: session_token (the same anchor used by save-draft and
// studio-self-edit). Refuses post-activation because at that point the
// GHL platform owns the relationship.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { resolveAdminNotificationRecipients } from '../_shared/admin-recipients.ts';
import { postSystemMessage } from '../_shared/inbox.ts';
import { adminNewServiceRequest } from '../_shared/email-templates.ts';

const ALLOWED_KINDS = new Set(['plan_upgrade', 'setup_change', 'custom_addon', 'other']);
const PLAN_ORDER: Record<string, number> = { launch: 1, scale: 2, ai: 3 };
const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL: Record<string, string> = { dfy: 'Done-For-You', guided: 'Guided self-setup' };

interface ValidationResult { ok: true; patch: Record<string, unknown> } // success
interface ValidationError { ok: false; status: number; error: string }

// Per-kind validation. Returns the row patch on success (kind +
// target_* columns), or an error response on rejection. Keeping this
// outside Deno.serve so the validation rules are easy to scan.
function validate(
  kind: string,
  body: Record<string, unknown>,
  row: Record<string, unknown>,
): ValidationResult | ValidationError {
  if (!ALLOWED_KINDS.has(kind)) {
    return { ok: false, status: 400, error: 'Unknown request kind.' };
  }
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
  if (!notes) {
    return { ok: false, status: 400, error: 'Tell us a bit about what you need so we can prepare a quote.' };
  }
  if (notes.length > 2000) {
    return { ok: false, status: 400, error: 'Notes are too long (max 2,000 characters).' };
  }

  if (kind === 'plan_upgrade') {
    const targetPlan = typeof body.target_plan === 'string' ? body.target_plan : '';
    if (!PLAN_ORDER[targetPlan]) {
      return { ok: false, status: 400, error: 'Pick a plan to upgrade to.' };
    }
    const currentPlan = String(row.plan || '');
    if (!PLAN_ORDER[currentPlan]) {
      return { ok: false, status: 400, error: 'Could not detect your current plan.' };
    }
    if (PLAN_ORDER[targetPlan] <= PLAN_ORDER[currentPlan]) {
      // Downgrades are operationally complex (proration, GHL feature
      // removal) and out of scope for this surface. Route to email so
      // a human can handle it.
      return {
        ok: false,
        status: 400,
        error: 'Downgrades and same-plan requests need a chat. Email info@studiolabsoftware.com and we will sort it.',
      };
    }
    return { ok: true, patch: { kind, target_plan: targetPlan, notes } };
  }

  if (kind === 'setup_change') {
    const targetSetup = typeof body.target_setup_type === 'string' ? body.target_setup_type : '';
    if (targetSetup !== 'dfy' && targetSetup !== 'guided') {
      return { ok: false, status: 400, error: 'Pick a setup type to switch to.' };
    }
    if (targetSetup === row.setup_type) {
      return { ok: false, status: 400, error: 'You are already on that setup type.' };
    }
    return { ok: true, patch: { kind, target_setup_type: targetSetup, notes } };
  }

  // custom_addon and other: notes-only, no target columns.
  return { ok: true, patch: { kind, notes } };
}

function describeRequest(patch: Record<string, unknown>, row: Record<string, unknown>): string {
  const kind = String(patch.kind);
  if (kind === 'plan_upgrade') {
    return `Plan upgrade: ${PLAN_LABEL[String(row.plan)] || row.plan} → ${PLAN_LABEL[String(patch.target_plan)] || patch.target_plan}`;
  }
  if (kind === 'setup_change') {
    return `Setup change: ${SETUP_LABEL[String(row.setup_type)] || row.setup_type} → ${SETUP_LABEL[String(patch.target_setup_type)] || patch.target_setup_type}`;
  }
  if (kind === 'custom_addon') {
    return 'Custom add-on request';
  }
  return 'General request';
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : '';
    const kind = typeof body.kind === 'string' ? body.kind : '';
    if (!sessionToken) return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);

    const sb = adminClient();
    const sessionHash = await sha256Hex(sessionToken);

    const { data: row, error: lookupErr } = await sb.from('submissions')
      .select('id, plan, setup_type, status, studio_name, contact_email, session_expires_at')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!row) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!row.session_expires_at || new Date(row.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired. Please verify your email again.' }, 401);
    }
    if (row.status === 'active') {
      return jsonResponse({
        ok: false,
        error: 'Your account is now live on our platform. Please raise changes from there.',
        code: 'account_active',
      }, 409);
    }
    if (row.status === 'draft') {
      // A draft studio hasn't even submitted the form yet -- they should
      // finish that first rather than raise a side-channel request.
      return jsonResponse({
        ok: false,
        error: 'Finish your setup form first, then you can request changes from your account.',
        code: 'still_draft',
      }, 409);
    }

    const result = validate(kind, body, row as Record<string, unknown>);
    if (!result.ok) return jsonResponse({ ok: false, error: result.error }, result.status);

    const patch = result.patch;
    const { data: created, error: insErr } = await sb.from('service_requests')
      .insert({ submission_id: row.id, ...patch })
      .select('*')
      .single();
    if (insErr) throw insErr;

    // System message into the inbox thread -- gives admin a chronological
    // anchor in the surface where they already work, and the studio
    // sees their own request alongside the conversation.
    const summary = describeRequest(patch, row as Record<string, unknown>);
    try {
      await postSystemMessage(
        sb,
        row.id,
        row.studio_name,
        `${row.studio_name || 'Studio'} raised a request — ${summary}. Notes: ${patch.notes}`,
      );
    } catch (e) { console.error('system message insert failed:', e); }

    // Admin notification email -- mode-gated. Test mode goes to owners
    // only via the standard recipients helper.
    try {
      const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
      const isLive = (settings?.stripe_mode || 'test') === 'live';
      const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';
      const sendGated = createGatedSender({ isLive, testRecipient });
      const adminTo = await resolveAdminNotificationRecipients(sb, isLive);
      if (adminTo.length) {
        const appUrl = Deno.env.get('ADMIN_APP_URL') || '';
        const tpl = adminNewServiceRequest({
          studioName: row.studio_name || '(no name)',
          contactEmail: row.contact_email || '',
          summary,
          notes: String(patch.notes || ''),
          adminUrl: appUrl ? `${appUrl}?id=${row.id}` : '',
        });
        await sendGated({
          to: adminTo,
          subject: tpl.subject,
          html: tpl.html,
          intent: 'studio service request',
        });
      }
    } catch (e) { console.error('admin notification failed:', e); }

    // Activity log -- mirrors studio-self-edit's audit pattern.
    try {
      await sb.from('activity_log').insert({
        submission_id: row.id,
        action: 'studio_service_request',
        actor: row.contact_email || 'studio',
        details: {
          request_id: created.id,
          kind: patch.kind,
          target_plan: patch.target_plan || null,
          target_setup_type: patch.target_setup_type || null,
        },
      });
    } catch (e) { console.error('activity log insert failed:', e); }

    return jsonResponse({ ok: true, request: created });
  } catch (err) {
    console.error('studio-request error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
