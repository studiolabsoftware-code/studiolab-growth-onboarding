// Post-issue management of finalized Stripe invoices.
// Admin-only. Two actions:
//
//   resend  - Calls Stripe POST /v1/invoices/:id/send to dispatch the
//             hosted-invoice email again. Bumps last_resent_at and
//             resend_count on the invoices row. Useful when a studio
//             reports "I never got it" or wants a fresh nudge.
//
//   void    - Calls Stripe POST /v1/invoices/:id/void to permanently
//             invalidate the invoice. Writes status='void' + voided_at
//             on the row. After voiding, the admin UI's Revise flow
//             opens a fresh invoice modal pre-filled from this one's
//             line items so the team can edit and re-issue.
//
// We don't try to "edit" a finalized invoice in place - Stripe's
// finalize-then-immutable rule makes that impossible. Voiding and
// recreating is the supported path.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { getStripeKey, stripeRequest } from '../_shared/stripe.ts';

interface RequestBody {
  action: 'resend' | 'void' | 'get-snapshot';
  invoice_id?: string;
  stripe_invoice_id?: string;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST required.' }, 405);

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Admin sign-in required.' }, 401);

    const body = await req.json().catch(() => ({})) as Partial<RequestBody>;
    const action = body.action;
    if (action !== 'resend' && action !== 'void' && action !== 'get-snapshot') {
      return jsonResponse({ ok: false, error: 'action must be resend, void, or get-snapshot.' }, 400);
    }
    const idInput = (body.invoice_id || '').trim();
    const stripeIdInput = (body.stripe_invoice_id || '').trim();
    if (!idInput && !stripeIdInput) {
      return jsonResponse({ ok: false, error: 'invoice_id or stripe_invoice_id is required.' }, 400);
    }

    const sb = adminClient();
    const query = idInput
      ? sb.from('invoices').select('id, stripe_invoice_id, status, submission_id, number, resend_count').eq('id', idInput).maybeSingle()
      : sb.from('invoices').select('id, stripe_invoice_id, status, submission_id, number, resend_count').eq('stripe_invoice_id', stripeIdInput).maybeSingle();
    const { data: row } = await query;
    if (!row) return jsonResponse({ ok: false, error: 'Invoice not found.' }, 404);
    if (!row.stripe_invoice_id) return jsonResponse({ ok: false, error: 'Invoice is missing a Stripe id.' }, 400);

    const secretKey = await getStripeKey();
    if (!secretKey) return jsonResponse({ ok: false, error: 'Stripe is not configured.' }, 500);

    if (action === 'get-snapshot') {
      // Fetch the full Stripe invoice including its line items so the admin
      // UI can rehydrate the create-invoice modal as a "revise" prefill
      // without voiding anything yet. The void only happens later when the
      // admin actually clicks Send on the revised modal.
      const snap = await stripeRequest<{
        id: string;
        currency?: string;
        collection_method?: string;
        days_until_due?: number | null;
        description?: string | null;
        customer_email?: string | null;
        customer_name?: string | null;
        customer_address?: { country?: string | null } | null;
        lines?: { data: Array<{
          description?: string | null;
          quantity?: number | null;
          amount?: number | null;            // total cents for the line
          unit_amount_excluding_tax?: number | null;
          price?: { unit_amount?: number | null; currency?: string } | null;
        }> };
      }>('GET', `invoices/${encodeURIComponent(row.stripe_invoice_id)}?expand[]=lines.data`, undefined, secretKey);
      if (!snap.ok || !snap.body) {
        return jsonResponse({ ok: false, error: snap.error || 'Could not fetch Stripe invoice.' }, 502);
      }
      const inv = snap.body;
      const lines = (inv.lines?.data || []).map((l) => {
        const qty = l.quantity || 1;
        // Stripe returns the line total in `amount` (cents). For per-unit
        // amount, prefer unit_amount_excluding_tax (created by our
        // create-custom-invoice with tax_behavior=exclusive), then fall back
        // to price.unit_amount, then divide amount by qty as a last resort.
        const unitCents = (typeof l.unit_amount_excluding_tax === 'number' ? l.unit_amount_excluding_tax
          : l.price?.unit_amount != null ? l.price.unit_amount
          : Math.round((l.amount || 0) / Math.max(qty, 1)));
        return {
          description: l.description || '',
          quantity: qty,
          unit_amount_cents: unitCents,
        };
      });
      return jsonResponse({
        ok: true,
        snapshot: {
          invoice_id: row.id,
          stripe_invoice_id: row.stripe_invoice_id,
          status: row.status,
          number: row.number,
          submission_id: row.submission_id,
          description: inv.description || '',
          currency: (inv.currency || 'aud').toUpperCase(),
          collection_method: inv.collection_method || 'send_invoice',
          due_days: inv.days_until_due || 14,
          customer_email: inv.customer_email || '',
          customer_name: inv.customer_name || '',
          customer_country: inv.customer_address?.country || '',
          lines,
        },
      });
    }

    if (action === 'resend') {
      if (row.status !== 'open' && row.status !== 'past_due') {
        return jsonResponse({
          ok: false,
          error: `Cannot resend a ${row.status} invoice. Only open invoices can be resent.`,
        }, 400);
      }
      const sent = await stripeRequest('POST', `invoices/${encodeURIComponent(row.stripe_invoice_id)}/send`, {}, secretKey);
      if (!sent.ok) {
        return jsonResponse({ ok: false, error: sent.error || 'Stripe resend failed.' }, 502);
      }
      const nowIso = new Date().toISOString();
      const newCount = (row.resend_count || 0) + 1;
      const { error: upErr } = await sb.from('invoices').update({
        last_resent_at: nowIso,
        resend_count: newCount,
      }).eq('id', row.id);
      if (upErr) console.warn('invoices update after resend failed:', upErr);

      try {
        await sb.from('activity_log').insert({
          submission_id: row.submission_id,
          action: 'invoice_resent',
          actor: caller.email,
          details: { invoice_id: row.id, stripe_invoice_id: row.stripe_invoice_id, number: row.number, resend_count: newCount },
        });
      } catch (e) { console.warn('activity_log insert failed:', e); }

      return jsonResponse({ ok: true, action: 'resend', resent_at: nowIso, resend_count: newCount });
    }

    // action === 'void'
    if (row.status === 'paid') {
      return jsonResponse({
        ok: false,
        error: 'Cannot void a paid invoice. Issue a refund through Stripe instead.',
      }, 400);
    }
    if (row.status === 'void') {
      return jsonResponse({ ok: true, action: 'void', skipped: true, reason: 'Already void.' });
    }
    const voided = await stripeRequest('POST', `invoices/${encodeURIComponent(row.stripe_invoice_id)}/void`, {}, secretKey);
    if (!voided.ok) {
      return jsonResponse({ ok: false, error: voided.error || 'Stripe void failed.' }, 502);
    }
    const nowIso = new Date().toISOString();
    const { error: upErr } = await sb.from('invoices').update({
      status: 'void',
      voided_at: nowIso,
    }).eq('id', row.id);
    if (upErr) console.warn('invoices update after void failed:', upErr);

    try {
      await sb.from('activity_log').insert({
        submission_id: row.submission_id,
        action: 'invoice_voided',
        actor: caller.email,
        details: { invoice_id: row.id, stripe_invoice_id: row.stripe_invoice_id, number: row.number },
      });
    } catch (e) { console.warn('activity_log insert failed:', e); }

    return jsonResponse({ ok: true, action: 'void', voided_at: nowIso });
  } catch (err) {
    console.error('manage-invoice error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
