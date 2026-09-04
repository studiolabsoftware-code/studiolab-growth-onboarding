// Is our Stripe webhook actually registered, enabled, and subscribed to the
// events we depend on?
//
// WHY THIS EXISTS. On 2026-08-11 someone reconfiguring webhooks on the shared
// Stripe account created the platform's production endpoint at 06:07 UTC. Our
// onboarding endpoint stopped receiving events about three hours later; it had
// carried 649 events since 2026-05-14 and then went silent for 15 days. Nothing
// alerted, because a deleted webhook has no failure mode: Stripe stops calling
// and everything downstream simply never happens.
//
// The cost was a real studio paying in full on 2026-08-26 with no studio
// receipt, no admin notification, no inbox record, and a submission still
// reading 'draft'/'pending'. It surfaced only because Gary happened to check
// Stripe directly.
//
// That account is shared with the platform's SaaS billing and the dev team works
// in it, so this can happen again at any time and is not something we control.
// The check therefore asserts CONFIGURATION, which is deterministic, rather than
// inferring health from traffic volume, which is not: our endpoint legitimately
// sees quiet stretches, so "no events lately" is a bad alarm on its own.

/** Events whose absence breaks a paying studio's onboarding, not merely a nicety. */
export const REQUIRED_EVENTS = [
  'checkout.session.completed',
  'payment_intent.succeeded',
  'charge.refunded',
] as const;

/** Only the fields we read from Stripe's webhook_endpoint object. */
export interface StripeWebhookEndpointLike {
  id: string;
  url: string;
  status: string;
  enabled_events: string[];
}

export type WebhookHealth =
  | { healthy: true; endpointId: string }
  | {
    healthy: false;
    problem: 'missing' | 'disabled' | 'missing_events';
    detail: string;
    endpointId?: string;
  };

/** Trailing slashes and host casing are not meaningful differences in a URL. */
function normaliseUrl(u: string): string {
  return String(u || '').trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Assess whether `endpoints` (as returned by GET /v1/webhook_endpoints) contains
 * a healthy registration for `expectedUrl`.
 *
 * Fails closed: anything we cannot positively confirm is reported as unhealthy,
 * because the whole point is that silence is indistinguishable from success.
 */
export function assessWebhookHealth(
  endpoints: StripeWebhookEndpointLike[],
  expectedUrl: string,
  requiredEvents: readonly string[] = REQUIRED_EVENTS,
): WebhookHealth {
  const want = normaliseUrl(expectedUrl);
  const matches = (endpoints || []).filter((e) => e && normaliseUrl(e.url) === want);

  if (matches.length === 0) {
    return {
      healthy: false,
      problem: 'missing',
      detail:
        `No Stripe webhook endpoint is registered for ${expectedUrl}. Payments will complete in ` +
        `Stripe and nothing downstream will run: no studio receipt, no admin notification, and the ` +
        `submission stays 'draft'/'pending'. This is what happened on 2026-08-11.`,
    };
  }

  // More than one registration for the same URL is legal in Stripe. Any single
  // enabled one is enough for delivery, so judge the best candidate, not the first.
  const enabled = matches.filter((e) => e.status === 'enabled');
  if (enabled.length === 0) {
    return {
      healthy: false,
      problem: 'disabled',
      detail:
        `The Stripe webhook endpoint for ${expectedUrl} exists but its status is ` +
        `'${matches[0].status}'. Stripe disables endpoints that fail repeatedly, so this usually ` +
        `means our function was erroring or unreachable, not that someone switched it off.`,
      endpointId: matches[0].id,
    };
  }

  // Stripe expresses "every event" as the literal '*'.
  const covers = (e: StripeWebhookEndpointLike) => {
    const set = new Set(e.enabled_events || []);
    if (set.has('*')) return [];
    return requiredEvents.filter((r) => !set.has(r));
  };

  // Pick the endpoint with the fewest gaps: if any one covers everything, we are healthy.
  let best = enabled[0];
  let bestMissing = covers(best);
  for (const e of enabled.slice(1)) {
    const m = covers(e);
    if (m.length < bestMissing.length) {
      best = e;
      bestMissing = m;
    }
  }

  if (bestMissing.length > 0) {
    return {
      healthy: false,
      problem: 'missing_events',
      detail:
        `The Stripe webhook endpoint for ${expectedUrl} is enabled but is not subscribed to: ` +
        `${bestMissing.join(', ')}. Those events are the ones that mark a submission paid and ` +
        `notify the studio and the admin team.`,
      endpointId: best.id,
    };
  }

  return { healthy: true, endpointId: best.id };
}
