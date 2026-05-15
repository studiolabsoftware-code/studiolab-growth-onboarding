// Daily cron-driven sweep over open quotes. Three jobs per run:
//
//   1. Day-7 nudge — quotes still 'sent' or 'viewed' whose sent_at is more
//      than 7 days ago and reminder_sent_at is null. Sends a soft follow-up
//      email and stamps reminder_sent_at.
//
//   2. Expiry-minus-5 warning — quotes still 'sent' or 'viewed' whose
//      expires_at is within the next 5 days and expiry_warning_sent_at is
//      null. Sends a clear "expires in N days" heads-up and stamps
//      expiry_warning_sent_at.
//
//   3. Auto-cancel — quotes still 'sent', 'viewed' or 'draft' whose
//      expires_at is in the past. Cancels via Stripe; the
//      stripe-webhook quote.canceled handler will mark the row as
//      'expired' (because expires_at < now).
//
// Auth: service-role bearer token (the pg_cron scheduler in
// 019_quote_reminders.sql passes it). No public access — admin sign-in is
// not required because there's no admin UI affordance for this; admins
// can manually re-run it by hitting the endpoint with the service-role
// key if needed.
//
// Email gating: ALL outbound mail goes through the same stripe_mode +
// STRIPE_TEST_EMAIL_RECIPIENT pattern as the rest of the system. In test
// mode without a redirect target, emails fall back to the real recipient
// (which is what the test studios are configured to be — Gmail aliases).
// See memory: project_email_gating_test_mode.

import { corsHeaders, preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { isServiceRoleCaller } from '../_shared/caller.ts';
import { getStripeKey, getStripeMode, stripeRequest } from '../_shared/stripe.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { quoteReminderNudge, quoteExpiryWarning } from '../_shared/email-templates.ts';

const NUDGE_AFTER_DAYS = 7;
const EXPIRY_WARNING_WITHIN_DAYS = 5;

function formatAmount(currency: string, totalCents: number): string {
  const dollars = (totalCents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const gstSuffix = currency === 'AUD' ? ' incl. GST' : '';
  return `${currency} $${dollars}${gstSuffix}`;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    // Auth gate: only the service role can run this. pg_cron passes
    // service_role_key in the Authorization header; manual re-runs from
    // the admin's machine use the same key. See _shared/caller.ts for the
    // two-path verification logic (exact env match OR role-claim JWT check).
    if (!isServiceRoleCaller(req)) {
      return jsonResponse({ ok: false, error: 'Service-role auth required.' }, 401);
    }

    const sb = adminClient();
    const stripeMode = await getStripeMode();
    const stripeKey = getStripeKey(stripeMode);
    const isLive = stripeMode === 'live';
    const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';

    // ---- Helper: route a transactional email through the test/live gate.
    async function gatedSend(to: string, subject: string, html: string, intent: string): Promise<void> {
      if (isLive) {
        await sendEmail({ to, subject, html, replyTo: 'info@studiolabsoftware.com' });
        return;
      }
      if (testRecipient) {
        await sendEmail({
          to: testRecipient,
          subject: `[TEST · ${intent}] ${subject}`,
          html,
          replyTo: 'info@studiolabsoftware.com',
        });
      } else {
        await sendEmail({ to, subject, html, replyTo: 'info@studiolabsoftware.com' });
      }
    }

    // ---- Helper: resolve recipient name + email for a quote row. Studio
    // recipients come from submissions; external recipients from
    // external_contacts via the column we added in migration 019.
    async function resolveRecipient(quote: { submission_id: string | null; external_contact_id: string | null }): Promise<{ email: string; name: string } | null> {
      if (quote.submission_id) {
        const { data } = await sb.from('submissions')
          .select('contact_email, first_name, last_name, studio_name')
          .eq('id', quote.submission_id)
          .maybeSingle();
        if (!data || !data.contact_email) return null;
        const name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim()
          || data.studio_name
          || 'there';
        return { email: data.contact_email, name };
      }
      if (quote.external_contact_id) {
        const { data } = await sb.from('external_contacts')
          .select('email, name')
          .eq('id', quote.external_contact_id)
          .maybeSingle();
        if (!data || !data.email) return null;
        return { email: data.email, name: data.name || 'there' };
      }
      return null;
    }

    const stats = {
      nudged: 0,
      warned: 0,
      cancelled: 0,
      errors: [] as string[],
    };

    const nowIso = new Date().toISOString();
    const cutoff7d = new Date(Date.now() - NUDGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const cutoff5d = new Date(Date.now() + EXPIRY_WARNING_WITHIN_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // ===== 1. Day-7 nudges ===================================================
    {
      const { data: nudgeRows } = await sb.from('quotes')
        .select('id, number, currency, total_cents, expires_at, sent_at, submission_id, external_contact_id')
        .in('status', ['sent', 'viewed'])
        .lt('sent_at', cutoff7d)
        .is('reminder_sent_at', null);

      for (const q of (nudgeRows || [])) {
        try {
          const recipient = await resolveRecipient(q);
          if (!recipient) continue;
          const daysLeft = q.expires_at
            ? Math.max(0, Math.ceil((new Date(q.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
            : 30;
          const tpl = quoteReminderNudge({
            recipientName: recipient.name,
            quoteNumber: q.number || '(pending)',
            amountDisplay: formatAmount(q.currency, q.total_cents),
            expiresInDays: daysLeft,
          });
          await gatedSend(recipient.email, tpl.subject, tpl.html, 'quote nudge (day 7)');
          await sb.from('quotes').update({ reminder_sent_at: nowIso }).eq('id', q.id);
          try {
            await sb.from('activity_log').insert({
              submission_id: q.submission_id,
              action: 'quote_reminded',
              actor: 'system',
              details: { quote_id: q.id, number: q.number, stage: 'day_7' },
            });
          } catch (e) { console.error('activity_log insert failed:', e); }
          stats.nudged++;
        } catch (e) {
          console.error('nudge failed for quote', q.id, e);
          stats.errors.push(`nudge:${q.id}`);
        }
      }
    }

    // ===== 2. Expiry-minus-5 warnings ========================================
    {
      const { data: warnRows } = await sb.from('quotes')
        .select('id, number, currency, total_cents, expires_at, submission_id, external_contact_id')
        .in('status', ['sent', 'viewed'])
        .gt('expires_at', nowIso)
        .lt('expires_at', cutoff5d)
        .is('expiry_warning_sent_at', null);

      for (const q of (warnRows || [])) {
        try {
          const recipient = await resolveRecipient(q);
          if (!recipient) continue;
          const daysLeft = q.expires_at
            ? Math.max(1, Math.ceil((new Date(q.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
            : 1;
          const tpl = quoteExpiryWarning({
            recipientName: recipient.name,
            quoteNumber: q.number || '(pending)',
            amountDisplay: formatAmount(q.currency, q.total_cents),
            expiresInDays: daysLeft,
          });
          await gatedSend(recipient.email, tpl.subject, tpl.html, 'quote expiry warning');
          await sb.from('quotes').update({ expiry_warning_sent_at: nowIso }).eq('id', q.id);
          try {
            await sb.from('activity_log').insert({
              submission_id: q.submission_id,
              action: 'quote_reminded',
              actor: 'system',
              details: { quote_id: q.id, number: q.number, stage: 'expiry_warning', days_left: daysLeft },
            });
          } catch (e) { console.error('activity_log insert failed:', e); }
          stats.warned++;
        } catch (e) {
          console.error('expiry warning failed for quote', q.id, e);
          stats.errors.push(`warn:${q.id}`);
        }
      }
    }

    // ===== 3. Auto-cancel expired quotes =====================================
    // Bypass the cancel-quote edge function and call Stripe directly — we
    // already have admin context (service-role caller) and the webhook
    // quote.canceled handler will discriminate expired vs declined from
    // expires_at, so the ledger correctly lands on status='expired'.
    {
      const { data: expiredRows } = await sb.from('quotes')
        .select('id, stripe_quote_id, number, status, submission_id')
        .in('status', ['draft', 'sent', 'viewed'])
        .lt('expires_at', nowIso);

      for (const q of (expiredRows || [])) {
        if (!q.stripe_quote_id) continue;
        try {
          const cancel = await stripeRequest<{ id: string; status: string }>(
            'POST',
            `quotes/${encodeURIComponent(q.stripe_quote_id)}/cancel`,
            null,
            stripeKey,
            `slg-expire-quote-${q.id}`,
          );
          if (!cancel.ok) {
            // Stripe will return an error if the quote is already canceled
            // or accepted. Log and continue; the webhook is the source of
            // truth and will eventually reconcile.
            console.warn('Stripe quote cancel returned non-OK', { id: q.id, status: cancel.status, error: cancel.error });
          } else {
            try {
              await sb.from('activity_log').insert({
                submission_id: q.submission_id,
                action: 'quote_expired',
                actor: 'system',
                details: { quote_id: q.stripe_quote_id, number: q.number, reason: 'auto_expired' },
              });
            } catch (e) { console.error('activity_log insert failed:', e); }
            stats.cancelled++;
          }
        } catch (e) {
          console.error('auto-cancel failed for quote', q.id, e);
          stats.errors.push(`expire:${q.id}`);
        }
      }
    }

    return jsonResponse({
      ok: true,
      stats,
      stripe_mode: stripeMode,
    });
  } catch (err) {
    console.error('quote-reminders error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
