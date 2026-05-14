// Stripe webhook receiver for the Growth onboarding flow. Deployed with
// --no-verify-jwt because Stripe does not present a JWT — instead it signs
// the request body and we verify against STRIPE_WEBHOOK_SECRET_TEST and/or
// STRIPE_WEBHOOK_SECRET_LIVE. We try both secrets so the same function can
// serve both Stripe environments without a redeploy.
//
// Idempotency is enforced by inserting into public.stripe_events on the
// event_id PK. A 23505 unique violation means Stripe has retried an event
// we already processed — we return 200 and skip side effects so retries
// remain safe. Anything else returning 500 will be retried by Stripe.
//
// IMPORTANT: signature verification needs the EXACT raw bytes Stripe sent,
// so we call req.text() once at the top and only JSON.parse from that
// string. Never await req.json() on a Stripe webhook request.

import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getStripeKey, stripeRequest, verifyStripeSignature, type StripeMode } from '../_shared/stripe.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import {
  paymentReceiptImmediate,
  paymentReceiptHold,
  paymentReceiptSaveCard,
  adminPaymentLanded,
} from '../_shared/email-templates.ts';

const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL: Record<string, string> = { dfy: 'Done-For-You', guided: 'Guided' };

type PaymentMode = 'immediate' | 'hold' | 'save_card';

interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

function plain(body: string, status: number): Response {
  return new Response(body, { status, headers: { ...corsHeaders, 'Content-Type': 'text/plain' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return plain('Method not allowed', 405);

  // 1. Read raw body BEFORE any parsing — signature is over exact bytes.
  const rawBody = await req.text();
  const sigHeader = req.headers.get('Stripe-Signature');

  const testSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET_TEST') || '';
  const liveSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET_LIVE') || '';

  // 2. Verify signature. Reject on failure with 400 so Stripe surfaces the
  // problem in the dashboard rather than retrying indefinitely.
  const verify = await verifyStripeSignature(rawBody, sigHeader, [testSecret, liveSecret]);
  if (!verify.ok) {
    console.error('stripe-webhook signature check failed:', verify.error);
    return plain(`Invalid signature: ${verify.error}`, 400);
  }

  // 3. Parse the event payload.
  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch (e) {
    console.error('stripe-webhook JSON parse failed:', e);
    return plain('Invalid JSON', 400);
  }
  if (!event || !event.id || !event.type) {
    return plain('Malformed event', 400);
  }

  const sb = adminClient();

  // 4. Idempotency: insert first, skip if already processed. Postgres unique
  // violation code is 23505. Any other DB error bubbles up as 500.
  const { error: insertErr } = await sb.from('stripe_events').insert({
    event_id: event.id,
    type: event.type,
    livemode: !!event.livemode,
    payload: event as unknown,
  });
  if (insertErr) {
    const code = (insertErr as { code?: string }).code;
    if (code === '23505') {
      return plain('Duplicate event — already processed.', 200);
    }
    console.error('stripe-webhook idempotency insert failed:', insertErr);
    return plain('Idempotency insert failed', 500);
  }

  // 5. Dispatch by event type. Each handler returns void on success or
  // throws on failure so the outer catch returns 500 → Stripe retries.
  const stripeMode: StripeMode = event.livemode ? 'live' : 'test';
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(sb, event.data.object as CheckoutSession, stripeMode);
        break;
      case 'checkout.session.expired':
        await handleCheckoutExpired(sb, event.data.object as CheckoutSession);
        break;
      case 'payment_intent.amount_capturable_updated':
        await handleAmountCapturableUpdated(sb, event.data.object as PaymentIntent);
        break;
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(sb, event.data.object as PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(sb, event.data.object as PaymentIntent);
        break;
      case 'payment_intent.canceled':
        await handlePaymentIntentCanceled(sb, event.data.object as PaymentIntent);
        break;
      case 'setup_intent.succeeded':
        await handleSetupIntentSucceeded(sb, event.data.object as SetupIntent);
        break;
      case 'setup_intent.setup_failed':
        await handleSetupIntentFailed(sb, event.data.object as SetupIntent);
        break;
      case 'invoice.finalized':
      case 'invoice.payment_succeeded':
      case 'invoice.voided':
      case 'invoice.payment_failed':
        await handleInvoiceUpdate(sb, event.data.object as InvoiceObj, event.type, event.id, event);
        break;
      case 'charge.refunded':
        await handleChargeRefunded(sb, event.data.object as ChargeObj, event.id, event);
        break;
      case 'payment_method.detached':
        await handlePaymentMethodDetached(sb, event.data.object as PaymentMethodObj);
        break;
      default:
        // Anything else: signature was valid, just nothing to do. Log so we
        // can see what Stripe is sending without retrying forever.
        console.log(`stripe-webhook: unhandled event type ${event.type} (${event.id})`);
    }
    return plain('ok', 200);
  } catch (err) {
    console.error(`stripe-webhook handler error for ${event.type} ${event.id}:`, err);
    // Roll back the idempotency row so Stripe's retry can re-attempt cleanly.
    await sb.from('stripe_events').delete().eq('event_id', event.id);
    return plain('Handler error', 500);
  }
});

// ============================================================================
// Type shapes (lightweight — we only declare the fields we read)
// ============================================================================
interface CheckoutSession {
  id: string;
  mode: 'payment' | 'setup' | 'subscription';
  customer: string | null;
  payment_intent: string | null;
  setup_intent: string | null;
  invoice: string | null;
  client_reference_id: string | null;
  amount_total: number | null;
  currency: string | null;
  total_details?: { amount_tax?: number | null } | null;
  metadata?: Record<string, string> | null;
}

interface PaymentIntent {
  id: string;
  status: string;
  amount: number | null;
  amount_received?: number | null;
  currency: string | null;
  customer: string | null;
  latest_charge: string | null;
  invoice: string | null;
  last_payment_error?: { message?: string; code?: string } | null;
  metadata?: Record<string, string> | null;
}

interface SetupIntent {
  id: string;
  status: string;
  customer: string | null;
  payment_method: string | null;
  last_setup_error?: { message?: string; code?: string } | null;
  metadata?: Record<string, string> | null;
}

interface InvoiceObj {
  id: string;
  number: string | null;
  status: string | null;            // 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  payment_intent: string | null;
  customer: string | null;
  subscription: string | null;      // PRESENT on subscription invoices (GHL SaaS)
  currency: string | null;
  subtotal: number | null;
  total: number | null;
  tax: number | null;
  amount_paid: number | null;
  amount_remaining: number | null;
  amount_due: number | null;
  total_discount_amounts?: Array<{ amount: number }> | null;
  due_date: number | null;          // unix seconds
  collection_method: string | null; // 'charge_automatically' | 'send_invoice'
  metadata?: Record<string, string> | null;
  status_transitions?: {
    finalized_at?: number | null;
    paid_at?: number | null;
    voided_at?: number | null;
    marked_uncollectible_at?: number | null;
  } | null;
}

interface ChargeObj {
  id: string;
  payment_intent: string | null;
  invoice: string | null;
  customer: string | null;
  amount_refunded: number;
  refunded: boolean;
  metadata?: Record<string, string> | null;
}

interface PaymentMethodObj {
  id: string;
  customer: string | null;
}

// ============================================================================
// Lookup helpers
// ============================================================================
type Sb = ReturnType<typeof adminClient>;

async function submissionByCheckoutSessionId(sb: Sb, sessionId: string) {
  const { data } = await sb.from('submissions')
    .select('*')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();
  return data;
}

async function submissionByPaymentIntentId(sb: Sb, paymentIntentId: string) {
  const { data } = await sb.from('submissions')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();
  return data;
}

async function submissionByCustomerId(sb: Sb, customerId: string) {
  // Used for setup_intent events that only carry the customer reference.
  const { data } = await sb.from('submissions')
    .select('*')
    .eq('stripe_customer_id', customerId)
    .order('last_saved_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function submissionByInvoiceId(sb: Sb, invoiceId: string) {
  const { data } = await sb.from('submissions')
    .select('*')
    .eq('stripe_invoice_id', invoiceId)
    .maybeSingle();
  return data;
}

async function resolveSubmissionFromMetadata(
  sb: Sb,
  meta: Record<string, string> | null | undefined,
): Promise<Record<string, unknown> | null> {
  const id = meta?.submission_id;
  if (!id) return null;
  const { data } = await sb.from('submissions').select('*').eq('id', id).maybeSingle();
  return data;
}

async function getPricingSnapshot(sb: Sb, submissionId: string) {
  const { data } = await sb.from('submission_pricing')
    .select('final_amount_cents, currency, list_amount_cents, discount_amount_cents, override_amount_cents')
    .eq('submission_id', submissionId)
    .maybeSingle();
  return data;
}

function refFor(submissionId: string): string {
  return String(submissionId).replace(/-/g, '').substring(0, 8).toUpperCase();
}

function adminUrlFor(submissionId: string): string {
  const appUrl = Deno.env.get('ADMIN_APP_URL') || '';
  return `${appUrl}?id=${submissionId}`;
}

// ============================================================================
// Event handlers
// ============================================================================

async function handleCheckoutCompleted(sb: Sb, session: CheckoutSession, stripeMode: StripeMode): Promise<void> {
  const submissionId = session.metadata?.submission_id || session.client_reference_id || '';
  let submission = submissionId
    ? (await sb.from('submissions').select('*').eq('id', submissionId).maybeSingle()).data
    : null;
  if (!submission) {
    submission = await submissionByCheckoutSessionId(sb, session.id);
  }
  if (!submission) {
    console.error(`checkout.session.completed: no submission for session ${session.id}`);
    return;
  }

  // Idempotency at the application level — if the submission is already
  // past 'pending', another delivery has already moved it. Bail early.
  if (submission.payment_status === 'paid'
      || submission.payment_status === 'authorised'
      || submission.payment_status === 'card_saved') {
    return;
  }

  const modeFromMeta = (session.metadata?.payment_mode as PaymentMode | undefined);
  const paymentMode: PaymentMode = modeFromMeta
    || (submission.payment_mode as PaymentMode | null)
    || (session.mode === 'setup' ? 'save_card' : 'immediate');

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: 'submitted',
    submitted_at: submission.submitted_at || nowIso,
    payment_mode: paymentMode,
    // Burn the studio's session token now that payment has landed — they
    // can no longer edit the draft.
    session_token_hash: null,
    session_expires_at: null,
  };

  // We need the studio-facing amount in their currency for the receipt. For
  // payment-mode sessions Stripe gives us amount_total + total_details on the
  // session; for setup-mode there is no amount on the session, so we fall
  // back to the snapshot in submission_pricing.
  let amountCents = 0;
  let currency = (session.currency || '').toUpperCase() || (submission.currency as string | null) || '';
  let taxCents: number | null = null;

  if (session.mode === 'payment') {
    amountCents = session.amount_total ?? 0;
    taxCents = session.total_details?.amount_tax ?? null;
    if (session.payment_intent) update.stripe_payment_intent_id = session.payment_intent;
    if (session.invoice) update.stripe_invoice_id = session.invoice;
    update.amount_paid_cents = amountCents;
    if (currency) update.currency = currency;
    if (taxCents !== null) update.tax_amount_cents = taxCents;

    if (paymentMode === 'immediate') {
      update.payment_status = 'paid';
      update.paid_at = nowIso;
      update.captured_at = nowIso;
    } else if (paymentMode === 'hold') {
      update.payment_status = 'authorised';
      // Stripe's default uncaptured PaymentIntent expires after 7 days.
      // Capture before then or the auth releases automatically.
      update.authorization_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    }
  } else if (session.mode === 'setup') {
    update.payment_status = 'card_saved';
    update.card_saved_at = nowIso;
    // Fetch the SetupIntent to record the saved payment method id — Stripe
    // does not include payment_method on the session object directly.
    if (session.setup_intent) {
      try {
        const secretKey = getStripeKey(stripeMode);
        const si = await stripeRequest<SetupIntent>('GET', `setup_intents/${session.setup_intent}`, null, secretKey);
        if (si.ok && si.body.payment_method) {
          update.payment_method_id = si.body.payment_method;
        }
      } catch (e) {
        console.error('checkout.session.completed: setup_intent fetch failed:', e);
      }
    }
    const snap = await getPricingSnapshot(sb, submission.id);
    if (snap) {
      amountCents = snap.final_amount_cents;
      currency = snap.currency;
      update.currency = currency;
    }
  }

  const { error: updErr } = await sb.from('submissions').update(update).eq('id', submission.id);
  if (updErr) throw updErr;

  // Activity log row — action type depends on mode.
  const action = paymentMode === 'immediate' ? 'payment_captured'
    : paymentMode === 'hold' ? 'payment_authorised'
    : 'payment_card_saved';
  try {
    await sb.from('activity_log').insert({
      submission_id: submission.id,
      action,
      actor: submission.contact_email || 'stripe',
      details: {
        stripe_mode: stripeMode,
        amount_cents: amountCents || null,
        currency: currency || null,
        tax_amount_cents: taxCents,
        session_id: session.id,
      },
    });
  } catch (e) { console.error('activity_log insert failed:', e); }

  // Studio confirmation email — mode-specific copy.
  const studioName = (submission.studio_name as string) || 'there';
  const ref = refFor(submission.id as string);
  const includesGst = (currency || '').toUpperCase() === 'AUD';

  try {
    if (paymentMode === 'immediate') {
      const t = paymentReceiptImmediate({
        studioName,
        ref,
        amountCents,
        currency: currency || 'AUD',
        includesGst,
        invoiceUrl: (submission.invoice_hosted_url as string | null) || null,
      });
      await sendEmail({
        to: submission.contact_email as string,
        subject: t.subject,
        html: t.html,
        replyTo: 'growth@studiolabgrowth.com',
      });
    } else if (paymentMode === 'hold') {
      const t = paymentReceiptHold({ studioName, ref, amountCents, currency: currency || 'AUD', includesGst });
      await sendEmail({
        to: submission.contact_email as string,
        subject: t.subject,
        html: t.html,
        replyTo: 'growth@studiolabgrowth.com',
      });
    } else {
      const t = paymentReceiptSaveCard({ studioName, ref, amountCents, currency: currency || 'AUD', includesGst });
      await sendEmail({
        to: submission.contact_email as string,
        subject: t.subject,
        html: t.html,
        replyTo: 'growth@studiolabgrowth.com',
      });
    }
  } catch (e) { console.error('studio receipt email failed:', e); }

  // Admin notification.
  try {
    const { data: admins } = await sb.from('admin_users').select('email').eq('is_active', true);
    if (admins && admins.length) {
      const t = adminPaymentLanded({
        studioName: (submission.studio_name as string) || '(no name)',
        plan: PLAN_LABEL[submission.plan as string] || (submission.plan as string),
        setup: SETUP_LABEL[submission.setup_type as string] || (submission.setup_type as string),
        mode: paymentMode,
        amountCents,
        currency: currency || 'AUD',
        includesGst,
        adminUrl: adminUrlFor(submission.id as string),
      });
      await sendEmail({ to: admins.map((a) => a.email), subject: t.subject, html: t.html });
    }
  } catch (e) { console.error('admin notification failed:', e); }

  // Append a system event to the studio's conversation timeline.
  try {
    const { postSystemMessage } = await import('../_shared/inbox.ts');
    const amountDisplay = `${currency || 'AUD'} $${(amountCents / 100).toFixed(2)}`;
    const verb = paymentMode === 'immediate' ? 'Payment received'
              : paymentMode === 'hold' ? 'Card authorised'
              : 'Card saved';
    await postSystemMessage(
      sb,
      submission.id as string,
      (submission.studio_name as string) || null,
      `💳 ${verb} — ${amountDisplay}`,
    );
  } catch (e) { console.error('system message (payment) failed:', e); }
}

async function handleCheckoutExpired(sb: Sb, session: CheckoutSession): Promise<void> {
  const submissionId = session.metadata?.submission_id || session.client_reference_id || '';
  const submission = submissionId
    ? (await sb.from('submissions').select('id, payment_status').eq('id', submissionId).maybeSingle()).data
    : await submissionByCheckoutSessionId(sb, session.id);
  if (!submission) return;
  // Only drop sessions still in 'pending' back to unpaid — anything already
  // paid/authorised/card_saved should not be reverted.
  if (submission.payment_status !== 'pending') return;

  await sb.from('submissions').update({
    payment_status: 'unpaid',
    stripe_checkout_session_id: null,
  }).eq('id', submission.id);

  try {
    await sb.from('activity_log').insert({
      submission_id: submission.id,
      action: 'payment_session_expired',
      actor: 'stripe',
      details: { session_id: session.id },
    });
  } catch (e) { console.error('activity_log insert failed:', e); }
}

async function handleAmountCapturableUpdated(sb: Sb, pi: PaymentIntent): Promise<void> {
  const submission = await resolveSubmissionFromMetadata(sb, pi.metadata)
    || await submissionByPaymentIntentId(sb, pi.id);
  if (!submission) return;

  const update: Record<string, unknown> = {
    stripe_payment_intent_id: pi.id,
    authorization_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  // If the submission is still in 'pending' at this point, promote it to
  // 'authorised'. If checkout.session.completed already did so, leave it.
  if (submission.payment_status === 'pending') {
    update.payment_status = 'authorised';
  }
  await sb.from('submissions').update(update).eq('id', submission.id);
}

async function handlePaymentIntentSucceeded(sb: Sb, pi: PaymentIntent): Promise<void> {
  const submission = await resolveSubmissionFromMetadata(sb, pi.metadata)
    || await submissionByPaymentIntentId(sb, pi.id);
  if (!submission) return;

  // In immediate mode this event arrives alongside checkout.session.completed,
  // which already set payment_status='paid' and logged 'payment_captured'.
  // Treat that case as a no-op so we do not duplicate the log row.
  if (submission.payment_status === 'paid') return;

  const nowIso = new Date().toISOString();
  const update: Record<string, unknown> = {
    stripe_payment_intent_id: pi.id,
    payment_status: 'paid',
    captured_at: nowIso,
    paid_at: submission.paid_at || nowIso,
    last_charge_attempt_at: nowIso,
    charge_failure_reason: null,
  };
  if (pi.amount_received) update.amount_paid_cents = pi.amount_received;
  if (pi.currency) update.currency = pi.currency.toUpperCase();

  await sb.from('submissions').update(update).eq('id', submission.id);

  try {
    await sb.from('activity_log').insert({
      submission_id: submission.id,
      action: 'payment_captured',
      actor: 'stripe',
      details: {
        payment_intent_id: pi.id,
        amount_received: pi.amount_received,
        currency: pi.currency,
      },
    });
  } catch (e) { console.error('activity_log insert failed:', e); }
}

async function handlePaymentIntentFailed(sb: Sb, pi: PaymentIntent): Promise<void> {
  const submission = await resolveSubmissionFromMetadata(sb, pi.metadata)
    || await submissionByPaymentIntentId(sb, pi.id);
  if (!submission) return;

  const reason = pi.last_payment_error?.message
    || pi.last_payment_error?.code
    || 'Payment failed';
  await sb.from('submissions').update({
    payment_status: 'charge_failed',
    last_charge_attempt_at: new Date().toISOString(),
    charge_failure_reason: reason,
  }).eq('id', submission.id);

  try {
    await sb.from('activity_log').insert({
      submission_id: submission.id,
      action: 'payment_failed',
      actor: 'stripe',
      details: { payment_intent_id: pi.id, reason },
    });
  } catch (e) { console.error('activity_log insert failed:', e); }
}

async function handlePaymentIntentCanceled(sb: Sb, pi: PaymentIntent): Promise<void> {
  const submission = await resolveSubmissionFromMetadata(sb, pi.metadata)
    || await submissionByPaymentIntentId(sb, pi.id);
  if (!submission) return;
  // Only relevant if we were holding an auth — otherwise it's a no-op.
  if (submission.payment_status !== 'authorised' && submission.payment_status !== 'pending') return;
  await sb.from('submissions').update({
    payment_status: 'auth_expired',
  }).eq('id', submission.id);

  try {
    await sb.from('activity_log').insert({
      submission_id: submission.id,
      action: 'payment_failed',
      actor: 'stripe',
      details: { payment_intent_id: pi.id, reason: 'authorisation_cancelled_or_expired' },
    });
  } catch (e) { console.error('activity_log insert failed:', e); }
}

async function handleSetupIntentSucceeded(sb: Sb, si: SetupIntent): Promise<void> {
  let submission = await resolveSubmissionFromMetadata(sb, si.metadata);
  if (!submission && si.customer) submission = await submissionByCustomerId(sb, si.customer);
  if (!submission) return;

  const update: Record<string, unknown> = {
    card_saved_at: submission.card_saved_at || new Date().toISOString(),
  };
  if (si.payment_method) update.payment_method_id = si.payment_method;
  if (submission.payment_status === 'pending') update.payment_status = 'card_saved';
  await sb.from('submissions').update(update).eq('id', submission.id);
}

async function handleSetupIntentFailed(sb: Sb, si: SetupIntent): Promise<void> {
  let submission = await resolveSubmissionFromMetadata(sb, si.metadata);
  if (!submission && si.customer) submission = await submissionByCustomerId(sb, si.customer);
  if (!submission) return;
  const reason = si.last_setup_error?.message || si.last_setup_error?.code || 'Card setup failed';
  await sb.from('submissions').update({
    payment_status: 'unpaid',
    charge_failure_reason: reason,
  }).eq('id', submission.id);

  try {
    await sb.from('activity_log').insert({
      submission_id: submission.id,
      action: 'payment_failed',
      actor: 'stripe',
      details: { setup_intent_id: si.id, reason },
    });
  } catch (e) { console.error('activity_log insert failed:', e); }
}

// ============================================================================
// Separation filter — see memory: project_billing_separation_rules
// ============================================================================
// The Stripe account is shared with GHL's SaaS Configurator. Every invoice
// event hits this webhook regardless of origin, so we filter every invoice-
// scoped action through this gate before writing to our ledger or mutating
// any submission. Conservative by default: if we can't prove the invoice is
// ours, we leave it alone.
async function classifyInvoice(
  sb: Sb,
  invoice: InvoiceObj,
): Promise<{ ours: true; source: 'studiolab-growth-setup' | 'studiolab-growth-custom' | 'studiolab-growth-quote' } | { ours: false; reason: string }> {
  // 1. Subscription invoices are always GHL's. The presence of the
  // `subscription` field on the Invoice object is the definitive signal.
  if (invoice.subscription) return { ours: false, reason: 'subscription_invoice' };

  // 2. Explicit source metadata wins. Our create-custom-invoice and
  // create-quote functions stamp this when they finalise an invoice.
  const metaSource = invoice.metadata?.source || '';
  if (metaSource === 'studiolab-growth-setup') return { ours: true, source: 'studiolab-growth-setup' };
  if (metaSource === 'studiolab-growth-custom') return { ours: true, source: 'studiolab-growth-custom' };
  if (metaSource === 'studiolab-growth-quote') return { ours: true, source: 'studiolab-growth-quote' };
  if (metaSource) return { ours: false, reason: `foreign_source:${metaSource}` };

  // 3. Stripe Checkout doesn't copy session metadata onto the Invoice it
  // creates, so setup-fee invoices arrive here with empty metadata. Fall
  // back to the payment_intent linkage — if a submission already owns the
  // PI, the invoice is its setup invoice.
  if (invoice.payment_intent) {
    const sub = await submissionByPaymentIntentId(sb, invoice.payment_intent);
    if (sub) return { ours: true, source: 'studiolab-growth-setup' };
  }

  // 4. If the invoice was already linked to a submission in a prior event,
  // reuse that classification.
  const prior = await submissionByInvoiceId(sb, invoice.id);
  if (prior) return { ours: true, source: 'studiolab-growth-setup' };

  // 5. Last resort: if the customer is one of ours but nothing links the
  // invoice to us, assume it's a GHL invoice on the shared customer and
  // skip. Better to under-process than to claim a foreign invoice.
  return { ours: false, reason: 'no_link_to_studiolab_growth' };
}

// Map Stripe invoice.status (which includes 'void') to our normalised set.
function normaliseInvoiceStatus(stripeStatus: string | null, refunded?: { partial?: boolean; full?: boolean }): string {
  if (refunded?.full) return 'refunded';
  if (refunded?.partial) return 'partially_refunded';
  switch (stripeStatus) {
    case 'draft': return 'draft';
    case 'open': return 'open';
    case 'paid': return 'paid';
    case 'void': return 'voided';
    case 'uncollectible': return 'uncollectible';
    default: return 'open';
  }
}

function tsFromUnix(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

async function upsertInvoiceLedger(
  sb: Sb,
  invoice: InvoiceObj,
  source: 'studiolab-growth-setup' | 'studiolab-growth-custom' | 'studiolab-growth-quote',
  submissionId: string | null,
  eventType: string,
  eventId: string,
  eventPayload: unknown,
): Promise<void> {
  const status = normaliseInvoiceStatus(invoice.status);
  const totalDiscount = (invoice.total_discount_amounts || []).reduce((sum, d) => sum + (d.amount || 0), 0);
  const kind = source === 'studiolab-growth-quote'
    ? 'quote_invoice'
    : source === 'studiolab-growth-custom'
      ? 'custom_charge'
      : 'setup_invoice';

  const row = {
    submission_id: submissionId,
    stripe_invoice_id: invoice.id,
    stripe_payment_intent_id: invoice.payment_intent,
    stripe_customer_id: invoice.customer,
    number: invoice.number,
    kind,
    source,
    status,
    currency: (invoice.currency || 'aud').toUpperCase(),
    subtotal_cents: invoice.subtotal ?? 0,
    discount_cents: totalDiscount,
    tax_cents: invoice.tax ?? 0,
    total_cents: invoice.total ?? 0,
    amount_paid_cents: invoice.amount_paid ?? 0,
    amount_remaining_cents: invoice.amount_remaining ?? 0,
    issued_at: tsFromUnix(invoice.status_transitions?.finalized_at),
    due_at: tsFromUnix(invoice.due_date),
    paid_at: tsFromUnix(invoice.status_transitions?.paid_at),
    voided_at: tsFromUnix(invoice.status_transitions?.voided_at),
    hosted_url: invoice.hosted_invoice_url,
    pdf_url: invoice.invoice_pdf,
    collection_method: invoice.collection_method,
  };

  // Upsert by stripe_invoice_id so multiple events on the same invoice
  // converge to one row. The source-immutability trigger will block any
  // attempt to change source on an existing row — that's intentional.
  const { data: upserted, error } = await sb.from('invoices')
    .upsert(row, { onConflict: 'stripe_invoice_id' })
    .select('id')
    .single();
  if (error) {
    console.error('invoices upsert failed:', error, { invoice_id: invoice.id, event: eventType });
    return;
  }

  // Audit row in invoice_events. Idempotent on (invoice_id, stripe_event_id).
  if (upserted?.id) {
    await sb.from('invoice_events').insert({
      invoice_id: upserted.id,
      stripe_event_id: eventId,
      type: eventType,
      payload: eventPayload,
    });
  }
}

async function logActivityForInvoice(
  sb: Sb,
  submissionId: string | null,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  if (!submissionId) return;
  try {
    await sb.from('activity_log').insert({
      submission_id: submissionId,
      action,
      actor: 'stripe',
      details,
    });
  } catch (e) { console.error('activity_log insert failed:', e); }
}

async function handleInvoiceUpdate(sb: Sb, invoice: InvoiceObj, eventType: string, eventId: string, eventPayload: unknown): Promise<void> {
  const classification = await classifyInvoice(sb, invoice);
  if (!classification.ours) {
    console.log(`stripe-webhook: ignoring invoice ${invoice.id} (${eventType}) — ${classification.reason}`);
    return;
  }

  // Match invoice → submission for any back-compatible mutations to the
  // submissions table. The ledger does not need a submission to be useful,
  // but the submission still carries the "active" invoice URL pair.
  let submission: Record<string, unknown> | null = null;
  if (invoice.payment_intent) {
    submission = await submissionByPaymentIntentId(sb, invoice.payment_intent);
  }
  if (!submission) {
    submission = await submissionByInvoiceId(sb, invoice.id);
  }

  await upsertInvoiceLedger(
    sb,
    invoice,
    classification.source,
    submission ? (submission.id as string) : null,
    eventType,
    eventId,
    eventPayload,
  );

  if (submission) {
    await sb.from('submissions').update({
      stripe_invoice_id: invoice.id,
      invoice_hosted_url: invoice.hosted_invoice_url,
      invoice_pdf_url: invoice.invoice_pdf,
    }).eq('id', submission.id);
  }

  // Activity log entries scoped to the lifecycle event.
  const submissionId = submission ? (submission.id as string) : null;
  if (eventType === 'invoice.finalized') {
    await logActivityForInvoice(sb, submissionId, 'invoice_issued', {
      invoice_id: invoice.id,
      number: invoice.number,
      total_cents: invoice.total,
      currency: invoice.currency,
      source: classification.source,
    });
  } else if (eventType === 'invoice.payment_succeeded') {
    await logActivityForInvoice(sb, submissionId, 'invoice_paid', {
      invoice_id: invoice.id,
      number: invoice.number,
      amount_paid_cents: invoice.amount_paid,
      currency: invoice.currency,
      source: classification.source,
    });
  } else if (eventType === 'invoice.voided') {
    await logActivityForInvoice(sb, submissionId, 'invoice_voided', {
      invoice_id: invoice.id,
      number: invoice.number,
      source: classification.source,
    });
  }
}

async function handleChargeRefunded(sb: Sb, charge: ChargeObj, eventId: string, eventPayload: unknown): Promise<void> {
  if (!charge.payment_intent) return;
  const submission = await submissionByPaymentIntentId(sb, charge.payment_intent);
  // Even without a submission, we may still own the invoice via the ledger;
  // try to locate the ledger row by payment_intent and update it.
  const { data: ledgerRow } = await sb.from('invoices')
    .select('id, total_cents, source')
    .eq('stripe_payment_intent_id', charge.payment_intent)
    .maybeSingle();

  if (!submission && !ledgerRow) {
    console.log(`stripe-webhook: ignoring charge.refunded ${charge.id} — no link to studiolab-growth`);
    return;
  }

  // Update submissions.payment_status for back-compat (only when fully refunded).
  if (submission) {
    await sb.from('submissions').update({
      payment_status: 'refunded',
    }).eq('id', submission.id);
  }

  // Update the ledger row's refund state. Partial vs full is determined by
  // comparing amount_refunded to total_cents on the ledger row.
  if (ledgerRow) {
    const total = ledgerRow.total_cents || 0;
    const refunded = charge.amount_refunded || 0;
    const status = charge.refunded || refunded >= total ? 'refunded' : 'partially_refunded';
    await sb.from('invoices').update({
      status,
      amount_refunded_cents: refunded,
      refunded_at: new Date().toISOString(),
    }).eq('id', ledgerRow.id);

    await sb.from('invoice_events').insert({
      invoice_id: ledgerRow.id,
      stripe_event_id: eventId,
      type: 'charge.refunded',
      payload: eventPayload,
    });
  }

  if (submission) {
    try {
      await sb.from('activity_log').insert({
        submission_id: submission.id,
        action: 'invoice_refunded',
        actor: 'stripe',
        details: {
          charge_id: charge.id,
          amount_refunded: charge.amount_refunded,
          refunded: charge.refunded,
        },
      });
    } catch (e) { console.error('activity_log insert failed:', e); }
  }
}

async function handlePaymentMethodDetached(sb: Sb, pm: PaymentMethodObj): Promise<void> {
  // Find any save-card submission still holding this payment_method id and
  // flag it so admin knows to request a new card before charging.
  const { data: rows } = await sb.from('submissions')
    .select('id, payment_status')
    .eq('payment_method_id', pm.id);
  if (!rows || rows.length === 0) return;
  for (const row of rows) {
    if (row.payment_status === 'card_saved') {
      await sb.from('submissions').update({
        payment_status: 'unpaid',
        charge_failure_reason: 'Saved card was detached. Request a new payment link.',
        payment_method_id: null,
      }).eq('id', row.id);

      try {
        await sb.from('activity_log').insert({
          submission_id: row.id,
          action: 'payment_failed',
          actor: 'stripe',
          details: { payment_method_id: pm.id, reason: 'payment_method_detached' },
        });
      } catch (e) { console.error('activity_log insert failed:', e); }
    }
  }
}
