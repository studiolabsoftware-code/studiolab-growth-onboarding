// Cron-driven assertion that our Stripe webhook is still registered.
//
// WHY. A deleted webhook has no failure mode. Stripe simply stops calling, and
// every downstream effect (studio receipt, admin notification, inbox record, the
// submission flipping to paid/submitted) silently never happens. On 2026-08-11
// our endpoint vanished from the shared Stripe account roughly three hours after
// someone created the platform's production endpoint on it. It had carried 649
// events since 2026-05-14. Nobody noticed for 15 days, until a studio paid
// AUD 768.90 and got nothing from us.
//
// That account is shared with the platform's SaaS billing and the dev team works
// in it, so we do not control whether this happens again. What we can control is
// whether it stays invisible for two weeks.
//
// Auth: service-role bearer, same as the other cron functions. Read-only against
// Stripe; it never creates, edits or deletes an endpoint.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { isServiceRoleCaller } from '../_shared/caller.ts';
import { isCronCaller } from '../_shared/cron-auth.ts';
import { getStripeKey, getStripeMode, stripeRequest } from '../_shared/stripe.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { resolveAdminNotificationRecipients } from '../_shared/admin-recipients.ts';
import {
  assessWebhookHealth,
  REQUIRED_EVENTS,
  type StripeWebhookEndpointLike,
} from '../_shared/webhook-health.ts';

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Deliberately inline rather than in _shared/email-templates.ts: this is an
// internal ops alert with one caller, not studio-facing copy that needs to stay
// consistent with the rest of the system's voice.
function alertHtml(detail: string, expectedUrl: string, lastEventAt: string | null): string {
  const last = lastEventAt
    ? `Last event we received: <strong>${esc(lastEventAt)}</strong>.`
    : 'We have <strong>never</strong> recorded an event from this endpoint.';
  return `
    <p><strong>The Stripe webhook for StudioLAB Growth onboarding is not healthy.</strong></p>
    <p>${esc(detail)}</p>
    <p>${last}</p>
    <p>While this is broken, a studio can pay successfully and receive nothing from us:
       no receipt, no notification to the team, and their submission stays in draft.</p>
    <p>Expected endpoint URL:<br><code>${esc(expectedUrl)}</code></p>
    <p>Required events: <code>${esc(REQUIRED_EVENTS.join(', '))}</code></p>
    <p>Fix it in Stripe under Workbench &rarr; Webhooks, then re-run this check.</p>
  `;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  // Either credential is accepted. pg_cron presents CRON_SECRET, the same token
  // the other scheduled functions use; a human re-running the check by hand
  // presents the service-role key. The vault entry that would have carried the
  // service-role key to pg_cron contained a placeholder for three months, so
  // relying on it alone is what kept this check unscheduled. See migration 050.
  if (!isCronCaller(req) && !(await isServiceRoleCaller(req))) {
    return jsonResponse({ ok: false, error: 'Forbidden.' }, 403);
  }

  try {
    const sb = adminClient();
    const mode = await getStripeMode();
    const secretKey = getStripeKey(mode);

    const expectedUrl = Deno.env.get('STRIPE_WEBHOOK_URL')
      || `${Deno.env.get('SUPABASE_URL') || ''}/functions/v1/stripe-webhook`;

    const res = await stripeRequest<{ data: StripeWebhookEndpointLike[] }>(
      'GET',
      'webhook_endpoints?limit=100',
      null,
      secretKey,
    );
    // A Stripe outage is not the same as a missing webhook. Report it as an
    // error rather than emailing "your webhook is gone" on a transient 500.
    if (!res.ok) {
      return jsonResponse({ ok: false, error: 'Could not list Stripe webhook endpoints.' }, 502);
    }

    const health = assessWebhookHealth(res.body?.data || [], expectedUrl);

    const { data: lastRow } = await sb.from('stripe_events')
      .select('received_at')
      .order('received_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const lastEventAt = (lastRow?.received_at as string | undefined) ?? null;

    if (health.healthy) {
      return jsonResponse({
        ok: true,
        healthy: true,
        mode,
        endpoint_id: health.endpointId,
        last_event_at: lastEventAt,
      });
    }

    // Unhealthy. Alert every active admin (owners only in test mode, per the
    // shared recipient rule). Alerting on every run is intentional: this stays
    // noisy until someone fixes it, which is the opposite of the failure that
    // produced it.
    const to = await resolveAdminNotificationRecipients(sb, mode === 'live');
    let alerted = false;
    if (to.length > 0) {
      await sendEmail({
        to,
        subject: `ACTION NEEDED: Stripe webhook is ${health.problem} (${mode} mode)`,
        html: alertHtml(health.detail, expectedUrl, lastEventAt),
      });
      alerted = true;
    }

    console.error('stripe-webhook-health: UNHEALTHY', {
      problem: health.problem,
      detail: health.detail,
      expectedUrl,
      lastEventAt,
      alerted,
    });

    return jsonResponse({
      ok: true,
      healthy: false,
      mode,
      problem: health.problem,
      detail: health.detail,
      endpoint_id: health.endpointId ?? null,
      last_event_at: lastEventAt,
      alerted,
    });
  } catch (err) {
    console.error('stripe-webhook-health failed:', err);
    return jsonResponse({ ok: false, error: 'Health check failed.' }, 500);
  }
});
