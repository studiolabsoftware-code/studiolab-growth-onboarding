// Run: deno test --allow-read supabase/functions/_shared/webhook-health.test.ts
//
// The regression under test is real and dated. On 2026-08-11 our Stripe webhook
// endpoint disappeared from a shared account and nothing noticed for 15 days,
// until a studio paid AUD 768.90 and received nothing from us. Every case below
// is a shape that must raise the alarm rather than pass quietly.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { assessWebhookHealth, REQUIRED_EVENTS, type StripeWebhookEndpointLike } from './webhook-health.ts';

const URL_ = 'https://hiaruvsdamggenhqdvtp.supabase.co/functions/v1/stripe-webhook';

function ep(over: Partial<StripeWebhookEndpointLike> = {}): StripeWebhookEndpointLike {
  return {
    id: 'we_test',
    url: URL_,
    status: 'enabled',
    enabled_events: [...REQUIRED_EVENTS],
    ...over,
  };
}

Deno.test('healthy when the endpoint is present, enabled and covers the required events', () => {
  const r = assessWebhookHealth([ep()], URL_);
  assert(r.healthy);
  assertEquals(r.endpointId, 'we_test');
});

Deno.test('the 2026-08-11 regression: other endpoints exist, ours does not', () => {
  // Exactly the state the live account was in: three platform endpoints, none ours.
  const others: StripeWebhookEndpointLike[] = [
    { id: 'we_a', url: 'https://app.studiolabsoftware.com/api/ghl-stripe-webhook', status: 'enabled', enabled_events: ['invoice.paid'] },
    { id: 'we_b', url: 'https://uat.studiolabsoftware.com/api/ghl-stripe-webhook', status: 'enabled', enabled_events: ['invoice.paid'] },
  ];
  const r = assessWebhookHealth(others, URL_);
  assert(!r.healthy);
  assertEquals(r.problem, 'missing');
});

Deno.test('empty endpoint list is missing, never healthy', () => {
  const r = assessWebhookHealth([], URL_);
  assert(!r.healthy);
  assertEquals(r.problem, 'missing');
});

Deno.test('a disabled endpoint is not healthy', () => {
  const r = assessWebhookHealth([ep({ status: 'disabled' })], URL_);
  assert(!r.healthy);
  assertEquals(r.problem, 'disabled');
  assertEquals(r.endpointId, 'we_test');
});

Deno.test('an endpoint missing checkout.session.completed is not healthy', () => {
  const r = assessWebhookHealth([ep({ enabled_events: ['payment_intent.succeeded', 'charge.refunded'] })], URL_);
  assert(!r.healthy);
  assertEquals(r.problem, 'missing_events');
  assert(r.detail.includes('checkout.session.completed'));
});

Deno.test("Stripe's '*' wildcard counts as covering everything", () => {
  const r = assessWebhookHealth([ep({ enabled_events: ['*'] })], URL_);
  assert(r.healthy);
});

Deno.test('extra events beyond the required set are fine', () => {
  const r = assessWebhookHealth([ep({ enabled_events: [...REQUIRED_EVENTS, 'quote.accepted', 'invoice.voided'] })], URL_);
  assert(r.healthy);
});

Deno.test('trailing slash and host casing are not real differences', () => {
  const r = assessWebhookHealth([ep({ url: URL_.toUpperCase() + '/' })], URL_);
  assert(r.healthy);
});

Deno.test('a disabled duplicate does not mask an enabled one', () => {
  const r = assessWebhookHealth([ep({ id: 'we_old', status: 'disabled' }), ep({ id: 'we_new' })], URL_);
  assert(r.healthy);
  assertEquals(r.endpointId, 'we_new');
});

Deno.test('with two enabled duplicates, one full registration is enough', () => {
  const partial = ep({ id: 'we_partial', enabled_events: ['charge.refunded'] });
  const full = ep({ id: 'we_full' });
  assert(assessWebhookHealth([partial, full], URL_).healthy);
  // Order must not decide the verdict.
  assert(assessWebhookHealth([full, partial], URL_).healthy);
});

Deno.test('two enabled but both partial reports the smallest gap', () => {
  const a = ep({ id: 'we_a', enabled_events: ['charge.refunded'] });
  const b = ep({ id: 'we_b', enabled_events: ['charge.refunded', 'payment_intent.succeeded'] });
  const r = assessWebhookHealth([a, b], URL_);
  assert(!r.healthy);
  assertEquals(r.problem, 'missing_events');
  assertEquals(r.endpointId, 'we_b');
  assert(r.detail.includes('checkout.session.completed'));
});

Deno.test('a different URL never satisfies the check', () => {
  const r = assessWebhookHealth([ep({ url: 'https://example.com/functions/v1/stripe-webhook' })], URL_);
  assert(!r.healthy);
  assertEquals(r.problem, 'missing');
});

Deno.test('every unhealthy verdict carries a detail an operator can act on', () => {
  const cases = [
    assessWebhookHealth([], URL_),
    assessWebhookHealth([ep({ status: 'disabled' })], URL_),
    assessWebhookHealth([ep({ enabled_events: [] })], URL_),
  ];
  for (const r of cases) {
    assert(!r.healthy);
    assert(r.detail.length > 40, 'detail should explain the consequence, not just name the problem');
    assert(r.detail.includes(URL_) || r.detail.includes('stripe-webhook'));
  }
});
