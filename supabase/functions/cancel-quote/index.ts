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
    if (!isServiceRoleCaller(req)) {
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

    const cancel = await stripeRequest<{ id: string; status: string }>(
      'POST',
      `quotes/${encodeURIComponent(quoteRow.stripe_quote_id)}/cancel`,
      null,
      secretKey,
      `slg-cancel-quote-${quoteRow.id}`,
    );
    if (!cancel.ok) {
      return jsonResponse({ ok: false, error: cancel.error || 'Stripe quote cancel failed.' }, 502);
    }

    // The Stripe webhook quote.canceled handler will discriminate
    // expired vs declined from expires_at. For admin-initiated cancellation
    // we override that decision here so the audit trail records the actual
    // reason. We write the activity log row but defer the status update to
    // the webhook (single source of truth).
    try {
      const action = reason === 'expired' ? 'quote_expired'
        : reason === 'replaced_by_revision' ? 'quote_cancelled'
        : 'quote_cancelled';
      await sb.from('activity_log').insert({
        submission_id: quoteRow.submission_id,
        action,
        actor: actorLabel,
        details: {
          quote_id: quoteRow.stripe_quote_id,
          number: quoteRow.number,
          reason,
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
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
