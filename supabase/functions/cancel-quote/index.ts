// Cancels a Stripe Quote. Admin-only. The Stripe webhook quote.canceled
// handler will reflect the cancellation onto our quotes ledger row — we do
// not write the status here, because the webhook is the single source of
// truth for quote-lifecycle state transitions and writing twice would race.
//
// Used by both:
//   * The admin "Cancel" action on the quotes panel
//   * The quote-reminders cron when a quote passes expires_at (auto-cancel)

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile, isServiceRoleCaller } from '../_shared/caller.ts';
import { getStripeKey, getStripeMode, stripeRequest } from '../_shared/stripe.ts';

interface RequestBody {
  quote_id?: string;          // our quotes.id (UUID)
  stripe_quote_id?: string;   // OR the Stripe quote id directly
  reason?: 'admin_cancelled' | 'expired' | 'replaced_by_revision';
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    // Two valid auth paths:
    //   1. Admin caller via Supabase JWT (the normal admin UI path)
    //   2. Service-role caller invoking from quote-reminders cron (passes
    //      Authorization: Bearer <service_role_key>) — see
    //      _shared/caller.ts:isServiceRoleCaller for the two-path verify.
    let actorLabel = 'system';
    if (!(await isServiceRoleCaller(req))) {
      const caller = await getCallerProfile(req);
      if (!caller) return jsonResponse({ ok: false, error: 'Admin sign-in required.' }, 401);
      actorLabel = caller.email;
    }

    const body = await req.json().catch(() => ({})) as Partial<RequestBody>;
    const quoteIdInput = (body.quote_id || '').trim();
    const stripeQuoteIdInput = (body.stripe_quote_id || '').trim();
    const reason = body.reason || 'admin_cancelled';
    if (!quoteIdInput && !stripeQuoteIdInput) {
      return jsonResponse({ ok: false, error: 'quote_id or stripe_quote_id is required.' }, 400);
    }

    const sb = adminClient();
    const query = quoteIdInput
      ? sb.from('quotes').select('id, stripe_quote_id, status, submission_id, number').eq('id', quoteIdInput).maybeSingle()
      : sb.from('quotes').select('id, stripe_quote_id, status, submission_id, number').eq('stripe_quote_id', stripeQuoteIdInput).maybeSingle();
    const { data: quoteRow } = await query;
    if (!quoteRow) return jsonResponse({ ok: false, error: 'Quote not found.' }, 404);
    if (!quoteRow.stripe_quote_id) return jsonResponse({ ok: false, error: 'Quote is missing a Stripe id.' }, 400);

    // Idempotent skip: already in a terminal state.
    const terminal = ['accepted', 'declined', 'expired', 'cancelled', 'revised'];
    if (terminal.includes(quoteRow.status as string)) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: `Quote already ${quoteRow.status}.`,
        quote: { id: quoteRow.id, status: quoteRow.status },
      });
    }

    const mode = await getStripeMode();
    const secretKey = getStripeKey(mode);

    // Stamp the cancel reason onto the Stripe Quote metadata BEFORE cancel
    // so the webhook quote.canceled handler can read it and pick the right
    // ledger status (cancelled vs expired vs declined). Without this, the
    // webhook falls back to its expires_at heuristic and writes 'declined'
    // even for admin cancels, leaving the 'cancelled' status enum
    // unreachable.
    const stripeReason = reason === 'expired' ? 'expired'
      : reason === 'replaced_by_revision' ? 'replaced_by_revision'
      : 'admin_cancelled';
    await stripeRequest(
      'POST',
      `quotes/${encodeURIComponent(quoteRow.stripe_quote_id)}`,
      { 'metadata[cancel_reason]': stripeReason },
      secretKey,
    );

    const cancel = await stripeRequest<{ id: string; status: string }>(
      'POST',
      `quotes/${encodeURIComponent(quoteRow.stripe_quote_id)}/cancel`,
      null,
      secretKey,
      `slg-cancel-quote-${quoteRow.id}`,
    );
    if (!cancel.ok) {
      console.error('quote cancel failed:', cancel.error);
      return jsonResponse({
        ok: false,
        error: 'Could not cancel the quote in Stripe. It may already be accepted or expired — refresh the panel to see the current status.',
      }, 502);
    }

    // Write the ledger status here too as an optimistic fallback. If the
    // webhook arrives first it'll have already set the status using the
    // metadata.cancel_reason we just stamped; if our update lands first,
    // the webhook's downgrade guard prevents it from clobbering. Either
    // way the UI shows the right pill within seconds of admin clicking
    // Cancel.
    const targetStatus = stripeReason === 'expired' ? 'expired'
      : stripeReason === 'replaced_by_revision' ? 'revised'
      : 'cancelled';
    await sb.from('quotes')
      .update({ status: targetStatus, declined_at: new Date().toISOString() })
      .eq('id', quoteRow.id)
      .in('status', ['draft', 'sent', 'viewed']);

    try {
      const action = stripeReason === 'expired' ? 'quote_expired' : 'quote_cancelled';
      await sb.from('activity_log').insert({
        submission_id: quoteRow.submission_id,
        action,
        actor: actorLabel,
        details: {
          quote_id: quoteRow.stripe_quote_id,
          number: quoteRow.number,
          reason: stripeReason,
        },
      });
    } catch (e) { console.error('activity_log insert failed:', e); }

    return jsonResponse({
      ok: true,
      quote: {
        id: quoteRow.id,
        stripe_quote_id: quoteRow.stripe_quote_id,
        stripe_status: cancel.body.status,
      },
    });
  } catch (err) {
    console.error('cancel-quote error:', err);
    return jsonResponse({
      ok: false,
      error: 'Could not cancel the quote. Please try again — if it persists, check the Stripe dashboard.',
    }, 500);
  }
});
