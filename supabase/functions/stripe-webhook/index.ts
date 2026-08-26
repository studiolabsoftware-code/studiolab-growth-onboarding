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
import { onInvoicePaid, spawnProjectFromQuote } from '../_shared/post-payment.ts';
import {
  paymentReceiptImmediate,
  paymentReceiptHold,
  paymentReceiptSaveCard,
  adminPaymentLanded,
  adminInvoicePaymentFailed,
} from '../_shared/email-templates.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { sendIfAllowed } from '../_shared/studio-email.ts';
import { resolveAdminNotificationRecipients } from '../_shared/admin-recipients.ts';

const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL: Record<string, string> = { dfy: 'Done-For-You', guided: 'Guided' };

type PaymentMode = 'immediate' | 'hold' | 'save_card';

interface StripeEvent {
  id: string;
  type: string;
  livemode: boolean;
  // `unknown`, deliberately, NOT Record<string, unknown>. The dispatch switch
  // below narrows this to a concrete shape per event type, and TypeScript
  // rejects a direct cast from Record<string, unknown> to those shapes as
  // insufficiently overlapping (TS2352). Narrowing this back produces 12 type
  // errors, which is how this file sat un-type-checked until 2026-08-26: the
  // deploy path never runs `deno check`, so nothing surfaced them.
  data: { object: unknown };
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
        await handlePaymentIntentSucceeded(sb, event.data.object as PaymentIntent, stripeMode);
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
      case 'quote.created':
      case 'quote.finalized':
      case 'quote.accepted':
      case 'quote.canceled':
        await handleQuoteUpdate(sb, event.data.object as QuoteObj, event.type);
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
  quote: string | null;             // PRESENT on invoices materialised from accepted quotes
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

interface QuoteObj {
  id: string;
  number: string | null;
  status: string | null;            // 'draft' | 'open' | 'accepted' | 'canceled'
  customer: string | null;
  invoice: string | null;           // populated after acceptance
  expires_at: number | null;
  status_transitions?: {
    accepted_at?: number | null;
    canceled_at?: number | null;
    finalized_at?: number | null;
  } | null;
  metadata?: Record<string, string> | null;
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

  // No early-return on already-paid status. Event delivery is unordered,
  // so checkout.session.completed can arrive AFTER payment_intent.succeeded
  // has already flipped payment_status to 'paid'. If we bail here, we miss
  // writing stripe_payment_intent_id (which the invoice classifier needs to
  // attribute the invoice to our submission) and miss stamping submitted_at.
  // Instead, every UPDATE below uses '|| existing' so re-running is safe;
  // receipts are deduplicated via receipts_sent_at; the activity_log insert
  // is wrapped in try/catch and an alreadyLoggedThisAction guard.
  const alreadyPaid = submission.payment_status === 'paid'
    || submission.payment_status === 'authorised'
    || submission.payment_status === 'card_saved';

  const modeFromMeta = (session.metadata?.payment_mode as PaymentMode | undefined);
  const paymentMode: PaymentMode = modeFromMeta
    || (submission.payment_mode as PaymentMode | null)
    || (session.mode === 'setup' ? 'save_card' : 'immediate');

  const nowIso = new Date().toISOString();

  // Identity + bookkeeping fields. These are always safe to (re-)write:
  // * status is 'submitted' or beyond — never regress
  // * submitted_at is COALESCE-style so we don't overwrite an earlier stamp
  // * payment_mode is sticky once set
  // * stripe_payment_intent_id is the critical one — without this set, the
  //   invoice.finalized handler can't classify the invoice as ours
  // * stripe_invoice_id is similar
  //
  // The session token is NOT burned here. The studio comes back from
  // Stripe Checkout (a separate domain) within seconds and lands on
  // payment-confirm.html, which needs the same session_token to fetch
  // their submission and render the confirmation. Burning the token
  // here meant the user got bounced to "We need to verify it is you"
  // immediately after a successful payment. The 90-day TTL set at
  // verify-otp covers everything the studio needs post-payment
  // (account.html, KB, project portal). Re-edit protection lives in
  // save-draft's row-status guard instead.
  const update: Record<string, unknown> = {
    status: 'submitted',
    submitted_at: submission.submitted_at || nowIso,
    payment_mode: submission.payment_mode || paymentMode,
  };

  let amountCents = 0;
  let currency = (session.currency || '').toUpperCase() || (submission.currency as string | null) || '';
  let taxCents: number | null = null;

  if (session.mode === 'payment') {
    amountCents = session.amount_total ?? 0;
    taxCents = session.total_details?.amount_tax ?? null;
    // Always write the linkage fields — without these set, invoice events
    // can't classify their invoice as ours and silently drop.
    if (session.payment_intent) update.stripe_payment_intent_id = session.payment_intent;
    if (session.invoice) update.stripe_invoice_id = session.invoice;
    if (!submission.amount_paid_cents && amountCents) update.amount_paid_cents = amountCents;
    if (currency && !submission.currency) update.currency = currency;
    if (taxCents !== null && submission.tax_amount_cents == null) update.tax_amount_cents = taxCents;

    // Status flip + timestamps — only on the FIRST event that promotes us
    // past 'pending'. If a sibling event already moved us, leave the
    // existing stamp alone.
    if (!alreadyPaid) {
      if (paymentMode === 'immediate') {
        update.payment_status = 'paid';
        update.paid_at = nowIso;
        update.captured_at = nowIso;
      } else if (paymentMode === 'hold') {
        update.payment_status = 'authorised';
        update.authorization_expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      }
    }
  } else if (session.mode === 'setup') {
    if (!alreadyPaid) {
      update.payment_status = 'card_saved';
      update.card_saved_at = nowIso;
    }
    if (session.setup_intent) {
      try {
        const secretKey = getStripeKey(stripeMode);
        const si = await stripeRequest<SetupIntent>('GET', `setup_intents/${session.setup_intent}`, null, secretKey);
        if (si.ok && si.body.payment_method && !submission.payment_method_id) {
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
      if (!submission.currency) update.currency = currency;
    }
  }

  const { error: updErr } = await sb.from('submissions').update(update).eq('id', submission.id);
  if (updErr) throw updErr;

  // Activity log row — action type depends on mode. Skip if already paid
  // because a sibling event (payment_intent.succeeded) has already logged
  // the state transition and we'd just be duplicating.
  const action = paymentMode === 'immediate' ? 'payment_captured'
    : paymentMode === 'hold' ? 'payment_authorised'
    : 'payment_card_saved';
  try {
    if (!alreadyPaid) await sb.from('activity_log').insert({
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

  // Receipts + admin notification + inbox post are handled by a shared
  // helper that runs at most once per submission. See sendPaymentReceiptsOnce.
  await sendPaymentReceiptsOnce(sb, {
    submissionId: submission.id as string,
    paymentMode,
    amountCents,
    taxCents,
    currency,
    stripeMode,
    contactEmail: submission.contact_email as string | null,
    studioName: (submission.studio_name as string) || null,
    plan: submission.plan as string | null,
    setupType: submission.setup_type as string | null,
    invoiceHostedUrl: (submission.invoice_hosted_url as string | null) || null,
  });
}

// ----------------------------------------------------------------------------
// Shared post-payment notifications — runs at most once per submission
// ----------------------------------------------------------------------------
// Receipts can be triggered by either checkout.session.completed OR
// payment_intent.succeeded depending on which event Stripe delivers first
// (retries can scramble order). To guarantee exactly-once delivery, the
// helper atomically claims submissions.receipts_sent_at with a conditional
// UPDATE; only the first concurrent caller wins and proceeds to send.
async function sendPaymentReceiptsOnce(
  sb: Sb,
  args: {
    submissionId: string;
    paymentMode: PaymentMode;
    amountCents: number;
    taxCents?: number | null;
    currency: string;
    stripeMode: StripeMode;
    contactEmail: string | null;
    studioName: string | null;
    plan: string | null;
    setupType: string | null;
    invoiceHostedUrl: string | null;
  },
): Promise<void> {
  // Atomic claim — only the first caller succeeds in setting the timestamp.
  // Subsequent callers see receipts_sent_at populated and select returns
  // no row, so we bail without re-sending. Burns one read+write per attempt
  // but guarantees correctness across retry storms and out-of-order events.
  const { data: claimed, error: claimErr } = await sb.from('submissions')
    .update({ receipts_sent_at: new Date().toISOString() })
    .eq('id', args.submissionId)
    .is('receipts_sent_at', null)
    .select('id')
    .maybeSingle();
  if (claimErr) {
    console.error('receipts claim update failed:', claimErr);
    return;
  }
  if (!claimed) {
    // Receipts already sent for this submission. Nothing to do.
    return;
  }

  const ref = refFor(args.submissionId);
  const studioName = args.studioName || 'there';
  const includesGst = (args.currency || '').toUpperCase() === 'AUD';
  const currency = args.currency || 'AUD';
  const isLive = args.stripeMode === 'live';
  const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';

  // Shared gating logic — see `_shared/email-gated.ts` for the rule.
  // Pre-resolved isLive + testRecipient because handlePaymentLanded fires
  // multiple emails per event (studio receipt + admin notification + inbox
  // system message), so we don't want one DB lookup per send.
  const sendGated = createGatedSender({ isLive, testRecipient });

  // Ensure the conversation row exists BEFORE we send the receipt so we
  // can set reply-to to its per-conversation routing address. Studios
  // replying to the receipt then land in the in-app inbox thread instead
  // of bouncing to a generic support address that has no routing wired
  // up. Best-effort: if conversation creation fails for any reason, fall
  // back to info@studiolabsoftware.com so the email still ships and at
  // least lands in the support inbox.
  let receiptReplyTo = 'info@studiolabsoftware.com';
  try {
    const { ensureConversationForSubmission, replyAddress } = await import('../_shared/inbox.ts');
    const convId = await ensureConversationForSubmission(sb, args.submissionId, args.studioName || null);
    if (convId) receiptReplyTo = replyAddress(convId);
  } catch (e) { console.error('receipt reply-to conversation lookup failed, falling back to info@:', e); }

  // Studio's account-portal URL. We don't have plaintext session_token here
  // (only the hash is stored), so we point at /account.html without one.
  // Same-browser studios (paid from this device) auto-auth via localStorage
  // session. Different-device opens fall through to the "verify your email"
  // copy on account.html — known suboptimal but acceptable for v1.
  const publicAppOrigin = Deno.env.get('PUBLIC_APP_ORIGIN') || 'https://app.studiolabgrowth.com';
  const accountUrl = `${publicAppOrigin.replace(/\/$/, '')}/account.html`;

  // Studio receipt — mode-specific template. Routed through sendIfAllowed
  // so the unsubscribe footer is auto-injected for spam-law compliance;
  // receipts are essential intents so opt-out cannot suppress them.
  try {
    if (args.contactEmail) {
      let tplResult: { subject: string; html: string } | null = null;
      let intent = '';
      if (args.paymentMode === 'immediate') {
        tplResult = paymentReceiptImmediate({
          studioName, ref,
          amountCents: args.amountCents, taxCents: args.taxCents ?? null, currency, includesGst,
          invoiceUrl: args.invoiceHostedUrl,
          accountUrl,
        });
        intent = 'studio receipt (immediate)';
      } else if (args.paymentMode === 'hold') {
        tplResult = paymentReceiptHold({ studioName, ref, amountCents: args.amountCents, currency, includesGst, accountUrl });
        intent = 'studio receipt (hold)';
      } else {
        tplResult = paymentReceiptSaveCard({ studioName, ref, amountCents: args.amountCents, currency, includesGst, accountUrl });
        intent = 'studio receipt (save card)';
      }
      if (tplResult) {
        await sendIfAllowed({
          sb,
          submissionId: args.submissionId,
          sender: sendGated,
          email: {
            to: args.contactEmail,
            subject: tplResult.subject,
            html: tplResult.html,
            replyTo: receiptReplyTo,
            intent,
          },
        });
      }
    }
  } catch (e) { console.error('studio receipt email failed:', e); }

  // Admin notification. Pull the full submission row so the email digest
  // contains every field — VAs can copy-paste straight from the email into
  // GHL without round-tripping to the admin UI. Recipient list is
  // mode-aware: live -> all active admins, test -> owner-only.
  try {
    const adminTo = await resolveAdminNotificationRecipients(sb, isLive);
    if (adminTo.length) {
      const { data: fullRow } = await sb.from('submissions')
        .select('*')
        .eq('id', args.submissionId)
        .maybeSingle();
      const { data: attachmentsRaw } = await sb.from('submission_attachments_view')
        .select('id, file_name, mime_type, size_bytes, uploaded_at, expires_at')
        .eq('submission_id', args.submissionId)
        .order('uploaded_at', { ascending: true });
      const adminBase = Deno.env.get('ADMIN_APP_URL') || '';
      const attachments = (attachmentsRaw || []).map((a: Record<string, unknown>) => ({
        file_name: String(a.file_name),
        mime_type: a.mime_type as string | null,
        size_bytes: a.size_bytes as number | null,
        uploaded_at: a.uploaded_at as string | null,
        expires_at: a.expires_at as string | null,
        download_url: `${adminBase}?id=${args.submissionId}#attachment-${a.id}`,
      }));
      const t = adminPaymentLanded({
        studioName: args.studioName || '(no name)',
        plan: PLAN_LABEL[args.plan || ''] || (args.plan || ''),
        setup: SETUP_LABEL[args.setupType || ''] || (args.setupType || ''),
        mode: args.paymentMode,
        amountCents: args.amountCents,
        currency,
        includesGst,
        adminUrl: adminUrlFor(args.submissionId),
        submission: fullRow || undefined,
        attachments,
      });
      await sendGated({ to: adminTo, subject: t.subject, html: t.html, intent: 'admin notification' });
    }
  } catch (e) { console.error('admin notification failed:', e); }

  // Inbox system message
  try {
    const { postSystemMessage } = await import('../_shared/inbox.ts');
    const amountDisplay = `${currency} $${(args.amountCents / 100).toFixed(2)}`;
    const verb = args.paymentMode === 'immediate' ? 'Payment received'
              : args.paymentMode === 'hold' ? 'Card authorised'
              : 'Card saved';
    await postSystemMessage(
      sb,
      args.submissionId,
      args.studioName,
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

async function handlePaymentIntentSucceeded(sb: Sb, pi: PaymentIntent, stripeMode: StripeMode): Promise<void> {
  const submission = await resolveSubmissionFromMetadata(sb, pi.metadata)
    || await submissionByPaymentIntentId(sb, pi.id);
  if (!submission) return;

  const wasAlreadyPaid = submission.payment_status === 'paid';

  // Update the submission's status fields. Idempotent: if already paid we
  // skip the status flip but still call the receipt helper at the end —
  // the helper is itself one-shot via receipts_sent_at, so a no-op there is
  // safe.
  if (!wasAlreadyPaid) {
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

  // Fire receipts. Safe to call regardless of which event handler wins the
  // race — the helper atomically claims submissions.receipts_sent_at and
  // bails if another caller already sent receipts for this submission.
  await sendPaymentReceiptsOnce(sb, {
    submissionId: submission.id as string,
    paymentMode: (submission.payment_mode as PaymentMode | null) || 'immediate',
    amountCents: pi.amount_received || (submission.amount_paid_cents as number | null) || 0,
    currency: (pi.currency || '').toUpperCase() || (submission.currency as string | null) || 'AUD',
    stripeMode,
    contactEmail: submission.contact_email as string | null,
    studioName: (submission.studio_name as string) || null,
    plan: submission.plan as string | null,
    setupType: submission.setup_type as string | null,
    invoiceHostedUrl: (submission.invoice_hosted_url as string | null) || null,
  });
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

  // 4. Quote-derived invoices. Stripe removed invoice_settings.metadata
  // from the Quotes API, so the resulting invoice no longer inherits our
  // source tag. The Invoice object still carries `invoice.quote` pointing
  // back to the quote id, which our quotes ledger keys off — if we have
  // a ledger row for that quote, the invoice is ours.
  if (invoice.quote) {
    const { data: q } = await sb.from('quotes')
      .select('id')
      .eq('stripe_quote_id', invoice.quote)
      .maybeSingle();
    if (q) return { ours: true, source: 'studiolab-growth-quote' };
  }

  // 5. If the invoice was already linked to a submission in a prior event,
  // reuse that classification.
  const prior = await submissionByInvoiceId(sb, invoice.id);
  if (prior) return { ours: true, source: 'studiolab-growth-setup' };

  // 6. Customer-based match. invoice.customer maps to a submission's
  // stripe_customer_id and the invoice has no subscription (branch 1
  // already filtered subscriptions), so this is one of our one-shot
  // invoices arriving before its PI got stored on the submission row.
  // Safe because GHL subscription invoices always carry invoice.subscription
  // and would have bailed at branch 1.
  if (invoice.customer) {
    const { data: byCustomer } = await sb.from('submissions')
      .select('id')
      .eq('stripe_customer_id', invoice.customer)
      .limit(1)
      .maybeSingle();
    if (byCustomer) return { ours: true, source: 'studiolab-growth-setup' };
  }

  // 7. Last resort: nothing links the invoice to us. Skip.
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
): Promise<{ id: string; external_contact_id: string | null } | null> {
  const status = normaliseInvoiceStatus(invoice.status);
  const totalDiscount = (invoice.total_discount_amounts || []).reduce((sum, d) => sum + (d.amount || 0), 0);
  const kind = source === 'studiolab-growth-quote'
    ? 'quote_invoice'
    : source === 'studiolab-growth-custom'
      ? 'custom_charge'
      : 'setup_invoice';

  // Look up the existing row (if any) so we can preserve identity columns
  // that create-custom-invoice or create-quote set at issue time but the
  // webhook does not know about (submission_id when not findable from PI,
  // and external_contact_id which never appears in Stripe metadata fields
  // we read here).
  const { data: existing } = await sb.from('invoices')
    .select('id, submission_id, external_contact_id')
    .eq('stripe_invoice_id', invoice.id)
    .maybeSingle();

  const row: Record<string, unknown> = {
    submission_id: submissionId ?? existing?.submission_id ?? null,
    external_contact_id: existing?.external_contact_id ?? null,
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
    .select('id, external_contact_id')
    .single();
  if (error) {
    console.error('invoices upsert failed:', error, { invoice_id: invoice.id, event: eventType });
    return null;
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
  return upserted as { id: string; external_contact_id: string | null };
}

// Bump external_contacts totals when an external invoice is paid or refunded.
// Best-effort; failures are logged and swallowed so a totals mismatch never
// blocks the primary ledger update.
async function bumpExternalContactOnPayment(
  sb: Sb,
  externalContactId: string,
  paidCents: number,
): Promise<void> {
  try {
    const { data: c } = await sb.from('external_contacts')
      .select('total_paid_cents')
      .eq('id', externalContactId)
      .maybeSingle();
    await sb.from('external_contacts').update({
      total_paid_cents: (c?.total_paid_cents || 0) + paidCents,
      last_paid_at: new Date().toISOString(),
    }).eq('id', externalContactId);
  } catch (e) { console.error('external_contacts paid update failed:', e); }
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

// Heads-up email to admins when Stripe reports invoice.payment_failed.
// Best-effort: errors here are caught at the call site so the webhook
// always returns 200. Reuses the test-mode email gating pattern.
async function notifyAdminsInvoicePaymentFailed(
  sb: Sb,
  ledgerRef: { id: string; external_contact_id: string | null } | null,
  invoice: InvoiceObj,
): Promise<void> {
  if (!ledgerRef) return;

  // Mode-aware admin fanout. Test mode -> owner-only so VAs aren't pinged
  // for sandbox failures; live mode -> every active admin. Read settings
  // once and pass the same isLive down to the gated sender below.
  const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
  const isLive = (settings?.stripe_mode || 'test') === 'live';
  const to = await resolveAdminNotificationRecipients(sb, isLive);
  if (to.length === 0) return;

  // upsertInvoiceLedger only returns id + external_contact_id; fetch the
  // wider field set we need for the email here. One query per failed
  // payment is fine — these are rare events.
  const { data: ledger } = await sb.from('invoices')
    .select('id, number, total_cents, currency, submission_id, external_contact_id, hosted_url')
    .eq('id', ledgerRef.id)
    .maybeSingle();
  if (!ledger) return;

  // Resolve a friendly recipient label from whichever side the invoice
  // belongs to. Falls back to '(unknown recipient)' rather than failing.
  let recipientLabel = '(unknown recipient)';
  if (ledger.submission_id) {
    const { data: sub } = await sb.from('submissions')
      .select('studio_name, first_name, last_name, contact_email')
      .eq('id', ledger.submission_id)
      .maybeSingle();
    recipientLabel = sub?.studio_name
      || [sub?.first_name, sub?.last_name].filter(Boolean).join(' ')
      || sub?.contact_email
      || recipientLabel;
  } else if (ledger.external_contact_id) {
    const { data: ec } = await sb.from('external_contacts')
      .select('name, email')
      .eq('id', ledger.external_contact_id)
      .maybeSingle();
    recipientLabel = ec?.name || ec?.email || recipientLabel;
  }

  // Stripe doesn't put the decline reason on the invoice object directly —
  // it lives on the latest_charge.outcome.seller_message or the failed
  // payment_intent.last_payment_error.message. Both are out of scope for
  // the v1 email; the link to the hosted invoice gives admins the full
  // context with one click. Pass null and surface that in the template.
  // Hash-param shape parsed by admin/js/dashboard.js maybeOpenFromUrl —
  // opens the Invoices list and (best-effort) focuses the row on admin boot.
  const adminUrl = `${Deno.env.get('ADMIN_APP_URL') || 'https://app.studiolabgrowth.com/admin/'}#invoice=${encodeURIComponent(ledger.id)}`;

  const t = adminInvoicePaymentFailed({
    recipientLabel,
    invoiceNumber: ledger.number,
    amountCents: ledger.total_cents ?? invoice.total ?? null,
    currency: ledger.currency || (invoice.currency || 'USD').toUpperCase(),
    reason: null,
    hostedInvoiceUrl: ledger.hosted_url || invoice.hosted_invoice_url || null,
    adminUrl,
  });

  const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';
  const send = createGatedSender({ isLive, testRecipient });

  await send({ to, subject: t.subject, html: t.html, intent: 'admin invoice.payment_failed' });
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

  const ledger = await upsertInvoiceLedger(
    sb,
    invoice,
    classification.source,
    submission ? (submission.id as string) : null,
    eventType,
    eventId,
    eventPayload,
  );

  // Back-link quote → invoice. When an accepted quote materialises an
  // invoice, Stripe sets invoice.quote to the originating quote id. We
  // record that linkage on our quotes ledger so the admin UI can show the
  // resulting invoice on the quote row and the studio's account.html can
  // surface the invoice in the existing Invoices section. Also stamps
  // quote_id on the invoice ledger row to preserve the lineage from the
  // invoice side.
  if (ledger && classification.source === 'studiolab-growth-quote' && invoice.quote) {
    const { data: quoteRow } = await sb.from('quotes')
      .select('id, submission_id, external_contact_id, resulting_invoice_id, project_id, service_request_id')
      .eq('stripe_quote_id', invoice.quote)
      .maybeSingle();
    if (quoteRow) {
      const updates: Record<string, unknown> = {};
      if (!quoteRow.resulting_invoice_id) updates.resulting_invoice_id = ledger.id;
      // If quote.accepted arrived first, the quote is already 'accepted'.
      // If invoice.finalized arrives first, advance to 'accepted' here so
      // the admin/studio UI never shows a "sent" quote that already has an
      // invoice attached.
      if (eventType === 'invoice.finalized') updates.status = 'accepted';
      if (Object.keys(updates).length) {
        await sb.from('quotes').update(updates).eq('id', quoteRow.id);
      }
      // Stamp quote_id + the quote's recipient linkage onto the invoice
      // row. Without copying submission_id (and external_contact_id), a
      // quote-derived invoice may land in the ledger with both NULL — which
      // means it never appears on the studio's account.html Invoices
      // section (filtered by submission_id) and the external contact's
      // totals don't update.
      const invoicePatch: Record<string, unknown> = { quote_id: quoteRow.id };
      if (quoteRow.submission_id && !submission) {
        invoicePatch.submission_id = quoteRow.submission_id;
      }
      if (quoteRow.external_contact_id) {
        invoicePatch.external_contact_id = quoteRow.external_contact_id;
      }
      // Phase 6.5 — if the quote already spawned a project (quote.accepted
      // for external recipients), link the resulting invoice to the same
      // project. Prevents invoice.paid from re-spawning when the invoice
      // is paid later.
      if (quoteRow.project_id) {
        invoicePatch.project_id = quoteRow.project_id;
      }
      await sb.from('invoices').update(invoicePatch).eq('id', ledger.id);

      // Service-request lifecycle hook. When a quote-driven invoice is
      // paid AND the originating quote was created from a service
      // request, flip the linked request to 'paid' so admin sees an
      // Apply button on the detail page. We don't auto-apply because
      // some kinds (custom_addon, other) don't have a structured target
      // -- the human still has to action delivery.
      if (eventType === 'invoice.payment_succeeded' && quoteRow.service_request_id) {
        try {
          await sb.from('service_requests')
            .update({ status: 'paid' })
            .eq('id', quoteRow.service_request_id)
            .in('status', ['quoted']);  // only transition awaiting-acceptance rows
        } catch (e) {
          console.error('service_request paid transition failed:', e);
        }
      }
    }
  }

  // External-contact totals bump on payment_succeeded.
  if (eventType === 'invoice.payment_succeeded' && ledger?.external_contact_id) {
    await bumpExternalContactOnPayment(sb, ledger.external_contact_id, invoice.amount_paid ?? 0);
    try {
      await sb.from('activity_log').insert({
        submission_id: null,
        action: 'external_contact_paid',
        actor: 'stripe',
        details: {
          external_contact_id: ledger.external_contact_id,
          invoice_id: invoice.id,
          number: invoice.number,
          amount_paid_cents: invoice.amount_paid,
          currency: invoice.currency,
        },
      });
    } catch (e) { console.error('activity_log insert failed:', e); }
  }

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
    // Single-dispatch post-payment workflow. Phase 6.1 stub; Phase 6.2 will
    // spawn projects + send the payment-received email from inside the
    // dispatcher. Manual mark-paid in manage-invoice calls the same hook.
    if (ledger?.id) {
      await onInvoicePaid(sb, {
        invoiceId: ledger.id,
        trigger: 'webhook',
        stripeInvoiceId: invoice.id,
        amountPaidCents: invoice.amount_paid ?? 0,
        currency: (invoice.currency || '').toUpperCase(),
      });
    }
  } else if (eventType === 'invoice.payment_failed') {
    // Surface the failure on the admin invoice list. Stripe's own dashboard
    // is the source of truth for *why* the charge declined; we mirror the
    // event so our timeline isn't missing a beat. The invoices row already
    // updated to status='past_due' (or unchanged) via the status mapper above.
    await logActivityForInvoice(sb, submissionId, 'payment_failed', {
      invoice_id: invoice.id,
      number: invoice.number,
      total_cents: invoice.total,
      currency: invoice.currency,
      source: classification.source,
    });
    console.warn(`stripe-webhook: invoice.payment_failed for ${invoice.id} (${invoice.number || 'unnumbered'}); admin should review.`);

    // Heads-up email to admins. Best-effort — a failed send here must not
    // tank the webhook. Stripe will retry the charge on its own schedule
    // and emails the recipient its own dunning notice.
    try {
      await notifyAdminsInvoicePaymentFailed(sb, ledger, invoice);
    } catch (e) {
      console.error('admin invoice.payment_failed email failed:', e);
    }
  } else if (eventType === 'invoice.voided') {
    await logActivityForInvoice(sb, submissionId, 'invoice_voided', {
      invoice_id: invoice.id,
      number: invoice.number,
      source: classification.source,
    });
  }
}

// ============================================================================
// Quote lifecycle handler
// ============================================================================
// Scoped to studiolab-growth-quote via metadata.source — GHL never issues
// Stripe Quotes, but the gate is explicit for consistency with the invoice
// handler and to defend against any future GHL feature that does. Conservative
// default: if metadata.source is missing or unknown, skip silently.
async function handleQuoteUpdate(sb: Sb, quote: QuoteObj, eventType: string): Promise<void> {
  const metaSource = quote.metadata?.source || '';
  if (metaSource !== 'studiolab-growth-quote') {
    // Try a fallback: a row in our quotes table keyed by stripe_quote_id.
    // Stamps source metadata on every quote we create, but if the metadata
    // is somehow stripped we still recognise our own quotes by id.
    const { data: known } = await sb.from('quotes')
      .select('id')
      .eq('stripe_quote_id', quote.id)
      .maybeSingle();
    if (!known) {
      console.log(`stripe-webhook: ignoring quote ${quote.id} (${eventType}) — not studiolab-growth-quote`);
      return;
    }
  }

  // Translate Stripe quote.status + cancellation reason into our enum. Stripe
  // does not distinguish "declined" vs "expired" on the Quote object — both
  // surface as status='canceled'. We use expires_at vs now to discriminate
  // when canceled fires, and fall back to 'declined' otherwise.
  let nextStatus: string | null = null;
  const updateRow: Record<string, unknown> = {
    stripe_quote_id: quote.id,
    number: quote.number,
    hosted_url: undefined,           // not exposed on the quote payload
  };

  if (eventType === 'quote.created' || eventType === 'quote.finalized') {
    // Confirm number + finalized timestamp. Don't downgrade an accepted
    // quote back to 'sent' if events arrive out of order.
    nextStatus = 'sent';
  } else if (eventType === 'quote.accepted') {
    nextStatus = 'accepted';
    const acceptedAt = quote.status_transitions?.accepted_at
      ? new Date(quote.status_transitions.accepted_at * 1000).toISOString()
      : new Date().toISOString();
    updateRow.accepted_at = acceptedAt;
    if (quote.invoice) {
      // Look up our invoices ledger row for the resulting invoice. The
      // invoice.finalized handler fires concurrently and writes that row;
      // if we land first it won't exist yet, so leave resulting_invoice_id
      // null and let the invoice handler back-link on its way through.
      const { data: invRow } = await sb.from('invoices')
        .select('id')
        .eq('stripe_invoice_id', quote.invoice)
        .maybeSingle();
      if (invRow) updateRow.resulting_invoice_id = invRow.id;
    }
  } else if (eventType === 'quote.canceled') {
    // Discriminator priority for the final ledger status:
    //   1. metadata.cancel_reason set by our cancel-quote function
    //      ('admin_cancelled' → cancelled, 'replaced_by_revision' → revised,
    //      'expired' → expired)
    //   2. expires_at vs now — if the quote's expiry has passed, treat as
    //      'expired' (the quote-reminders cron auto-cancels at expiry)
    //   3. Fall back to 'declined' for everything else (recipient-initiated
    //      cancellations via the Stripe-hosted page, or Stripe dashboard
    //      cancellations with no metadata)
    const cancelReason = quote.metadata?.cancel_reason || '';
    if (cancelReason === 'admin_cancelled') {
      nextStatus = 'cancelled';
    } else if (cancelReason === 'replaced_by_revision') {
      nextStatus = 'revised';
    } else if (cancelReason === 'expired') {
      nextStatus = 'expired';
    } else {
      const nowSec = Math.floor(Date.now() / 1000);
      const expired = quote.expires_at && quote.expires_at <= nowSec;
      nextStatus = expired ? 'expired' : 'declined';
    }
    const canceledAt = quote.status_transitions?.canceled_at
      ? new Date(quote.status_transitions.canceled_at * 1000).toISOString()
      : new Date().toISOString();
    updateRow.declined_at = canceledAt;
  }

  // Read the current row so we don't downgrade status or clobber identity.
  const { data: current } = await sb.from('quotes')
    .select('id, submission_id, status, accepted_at, declined_at, resulting_invoice_id')
    .eq('stripe_quote_id', quote.id)
    .maybeSingle();

  if (!current) {
    // The quote came from outside (e.g. created in Stripe dashboard). We do
    // not insert orphan rows here — admin should use create-quote so the
    // ledger row exists at issue time. Skip and log.
    console.log(`stripe-webhook: quote ${quote.id} not in ledger — skipping (event ${eventType})`);
    // Surface dashboard-initiated cancels to admin (audit finding). The
    // skip-and-log default is silent and admins had no way to learn when
    // a Stripe-side action drifted from the StudioLAB ledger. Other event
    // types (created/finalized/accepted) are noisier, so only escalate
    // canceled — that's the case where money was potentially in motion
    // and the recipient now thinks the quote is dead.
    if (eventType === 'quote.canceled') {
      try {
        const { adminQuoteCanceledOrphan } = await import('../_shared/email-templates.ts');
        // Self-contained gated sender: handleQuoteUpdate doesn't have
        // access to the per-checkout sendGated. Same gating logic — test
        // mode without STRIPE_TEST_EMAIL_RECIPIENT falls back to the
        // real recipient, and admin fanout is owner-only in test mode.
        const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
        const isLive = (settings?.stripe_mode || 'test') === 'live';
        const adminTo = await resolveAdminNotificationRecipients(sb, isLive);
        if (adminTo.length) {
          const adminUrl = Deno.env.get('ADMIN_APP_URL') || '';
          const recipientHint = (quote as { customer_email?: string | null }).customer_email
            || (quote.metadata?.email as string | undefined)
            || null;
          const tpl = adminQuoteCanceledOrphan({
            stripeQuoteId: quote.id,
            number: quote.number,
            recipientHint,
            adminUrl,
          });
          const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';
          const send = createGatedSender({ isLive, testRecipient });
          await send({
            to: adminTo,
            subject: tpl.subject,
            html: tpl.html,
            intent: 'orphan quote cancel',
          });
        }
      } catch (e) { console.error('orphan-cancel admin email failed:', e); }
    }
    return;
  }

  // Status downgrade guard. accepted > declined/expired > sent > draft.
  const order: Record<string, number> = {
    draft: 0, sent: 1, viewed: 1, accepted: 3, declined: 2, expired: 2, cancelled: 2, revised: 2,
  };
  const currentStatus = current.status as string;
  const shouldAdvance = !!nextStatus && (order[nextStatus] ?? 0) > (order[currentStatus] ?? 0);
  if (shouldAdvance) {
    updateRow.status = nextStatus as string;
  } else if (nextStatus && nextStatus === currentStatus) {
    // Same status as already recorded (e.g. create-quote stamped 'sent' and
    // quote.finalized arrives saying 'sent' again). Skip the redundant
    // write to keep the activity feed quieter and avoid touching
    // updated_at for no real change.
    for (const k of Object.keys(updateRow)) {
      if (k === 'stripe_quote_id' || k === 'number' || k === 'hosted_url') continue;
      if (updateRow[k] === undefined) delete updateRow[k];
    }
  }

  // Clean undefined keys (we used `undefined` as a marker for "don't write").
  for (const k of Object.keys(updateRow)) {
    if (updateRow[k] === undefined) delete updateRow[k];
  }

  // Conditional update: only write if the row's status is still what we
  // read above. This closes the read-modify-write race where two webhook
  // events for the same quote land within milliseconds (e.g. quote.accepted
  // and quote.canceled). Without the .eq('status', currentStatus) filter,
  // the later writer can downgrade a terminal status without re-evaluating
  // the guard. PostgreSQL serialises the WHERE-matched updates, so the
  // first writer wins and the second's update affects 0 rows. We re-read
  // and try again so the second event can re-evaluate against the new
  // canonical state.
  const { data: applied, error } = await sb.from('quotes')
    .update(updateRow)
    .eq('id', current.id)
    .eq('status', currentStatus)
    .select('id');
  if (error) {
    console.error('quotes update failed:', error, { quote_id: quote.id, event: eventType });
    return;
  }
  if (!applied || applied.length === 0) {
    // Lost the race. Re-read and re-evaluate so we don't silently drop the
    // event — it might still need to advance the freshly-written status
    // (e.g. quote.accepted arrived after quote.viewed bumped the row to
    // 'viewed'). One retry is sufficient: if it loses again we abort and
    // log, because that means a third event is also in flight and the
    // ordering is genuinely ambiguous.
    const { data: refreshed } = await sb.from('quotes')
      .select('id, status')
      .eq('id', current.id)
      .maybeSingle();
    if (!refreshed) return;
    const refreshedStatus = refreshed.status as string;
    const stillShouldAdvance = !!nextStatus
      && (order[nextStatus] ?? 0) > (order[refreshedStatus] ?? 0);
    if (!stillShouldAdvance) {
      // The other writer's value already supersedes ours. Done.
      return;
    }
    updateRow.status = nextStatus as string;
    const { error: retryErr } = await sb.from('quotes')
      .update(updateRow)
      .eq('id', current.id)
      .eq('status', refreshedStatus);
    if (retryErr) {
      console.error('quotes update retry failed:', retryErr, { quote_id: quote.id, event: eventType });
      return;
    }
  }

  // Phase 6.5 — quote.accepted spawns a project (status='briefing') for
  // external recipients only. Idempotent inside spawnProjectFromQuote so
  // event redelivery is safe.
  if (eventType === 'quote.accepted' && current.id) {
    try {
      const spawnRes = await spawnProjectFromQuote(sb, current.id);
      if (spawnRes.ok && !spawnRes.was_existing) {
        console.log(`stripe-webhook: spawned project ${spawnRes.project_id} from quote ${quote.id}`);
      }
    } catch (e) {
      console.warn('quote.accepted project spawn failed:', e);
    }
  }

  // Activity log mapping. submission_id is null for external recipients.
  const action = eventType === 'quote.accepted' ? 'quote_accepted'
    : eventType === 'quote.canceled'
      ? (updateRow.status === 'expired' ? 'quote_expired'
        : updateRow.status === 'cancelled' || updateRow.status === 'revised' ? 'quote_cancelled'
        : 'quote_declined')
      : null;
  if (action) {
    try {
      await sb.from('activity_log').insert({
        submission_id: current.submission_id,
        action,
        actor: 'stripe',
        details: {
          quote_id: quote.id,
          number: quote.number,
          resulting_invoice: quote.invoice,
        },
      });
    } catch (e) { console.error('activity_log insert failed:', e); }
  }
}

async function handleChargeRefunded(sb: Sb, charge: ChargeObj, eventId: string, eventPayload: unknown): Promise<void> {
  // Two lookup paths because the invoices ledger is not guaranteed to
  // have stripe_payment_intent_id stamped at create time: for invoices
  // born inside a Checkout Session, the PI is sometimes still null when
  // invoice.finalized lands, so the row was inserted with NULL PI and
  // never refreshed. Refunds then silently no-op'd because the PI lookup
  // returned nothing.
  //
  // 1. Try by payment_intent first (the common case for direct PI flows).
  // 2. Fall back to charge.invoice -> stripe_invoice_id on the ledger.
  // 3. Whenever we resolve via the invoice path AND the row is missing
  //    its PI, backfill it so future events on the same row find it.
  let submission = charge.payment_intent
    ? await submissionByPaymentIntentId(sb, charge.payment_intent)
    : null;

  let ledgerRow: { id: string; total_cents: number | null; source: string | null; submission_id: string | null; stripe_payment_intent_id: string | null } | null = null;
  if (charge.payment_intent) {
    const { data } = await sb.from('invoices')
      .select('id, total_cents, source, submission_id, stripe_payment_intent_id')
      .eq('stripe_payment_intent_id', charge.payment_intent)
      .maybeSingle();
    ledgerRow = data;
  }

  // Fallback path 1: look up by charge.invoice. Covers historical rows
  // missing PI and any future case where the PI is attached after the
  // invoice ledger row was first persisted.
  const chargeInvoice = (charge as { invoice?: string | null }).invoice;
  if (!ledgerRow && chargeInvoice) {
    const { data } = await sb.from('invoices')
      .select('id, total_cents, source, submission_id, stripe_payment_intent_id')
      .eq('stripe_invoice_id', chargeInvoice)
      .maybeSingle();
    ledgerRow = data;
    // Backfill PI when we found the row via the invoice path. Best-effort.
    if (ledgerRow && !ledgerRow.stripe_payment_intent_id && charge.payment_intent) {
      try {
        await sb.from('invoices')
          .update({ stripe_payment_intent_id: charge.payment_intent })
          .eq('id', ledgerRow.id);
      } catch (e) { console.error('PI backfill failed:', e); }
    }
    // If the submission lookup by PI returned nothing, the ledger row
    // may still know which submission this belongs to.
    if (!submission && ledgerRow?.submission_id) {
      const { data: sub } = await sb.from('submissions')
        .select('id, payment_status')
        .eq('id', ledgerRow.submission_id)
        .maybeSingle();
      submission = sub;
    }
  }

  // Fallback path 2: submission-anchored lookup. Hit on 2026-05-18 when a
  // Stripe Checkout test refund landed with BOTH charge.payment_intent
  // unmatched on the ledger AND charge.invoice null on the Stripe payload.
  // The submissions row had the PI (set at checkout.session.completed)
  // so we found the submission; from there we can resolve the most
  // recent paid invoice for that submission and treat it as the target
  // of the refund. Single paid invoice per submission is the common case
  // for setup payments; if there were multiple, the most recent paid
  // is the correct match because Stripe Dashboard refunds always target
  // the most recent charge associated with the customer's latest invoice.
  if (!ledgerRow && submission) {
    const { data } = await sb.from('invoices')
      .select('id, total_cents, source, submission_id, stripe_payment_intent_id')
      .eq('submission_id', submission.id)
      .in('status', ['paid'])
      .order('paid_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    ledgerRow = data;
    // Backfill PI on whichever ledger row we land on so the next event
    // (e.g. a subsequent partial refund) hits the primary path.
    if (ledgerRow && !ledgerRow.stripe_payment_intent_id && charge.payment_intent) {
      try {
        await sb.from('invoices')
          .update({ stripe_payment_intent_id: charge.payment_intent })
          .eq('id', ledgerRow.id);
      } catch (e) { console.error('PI backfill (submission path) failed:', e); }
    }
  }

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
