// Daily nudge for Dominate AI studios who paid but never finalised their
// knowledge base. Selects rows where the scrape finished more than 24h ago,
// kb_completed_at is still null, and we have not nudged them yet — sends a
// "your AI is almost ready" email with a resume link, then stamps
// kb_abandonment_nudged_at so we only ping once.
//
// Invoked by a scheduled job (Supabase pg_cron or an external scheduler).
// The caller must present the CRON_SECRET as a Bearer token; without it the
// function refuses to run so this endpoint cannot be triggered from the
// public web.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { loadStudioEmailPrefs, unsubscribeUrl, injectUnsubscribeFooter } from '../_shared/studio-email.ts';
import { kbAbandonmentNudge } from '../_shared/email-templates.ts';

const PAID_STATUSES = ['paid', 'authorised', 'card_saved'];
const NUDGE_AFTER_HOURS = 24;
// Defensive cap. The daily window should normally yield a handful of rows;
// a much larger batch suggests something upstream is wedged and we would
// rather log the count than blast the inbox.
const MAX_PER_RUN = 200;

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected) return false;
  const authz = req.headers.get('Authorization') || '';
  const token = authz.replace(/^Bearer\s+/i, '').trim();
  return token === expected;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  if (!isAuthorized(req)) {
    return jsonResponse({ ok: false, error: 'Unauthorized.' }, 401);
  }

  try {
    const dryRun = new URL(req.url).searchParams.get('dry_run') === '1';
    const cutoff = new Date(Date.now() - NUDGE_AFTER_HOURS * 60 * 60 * 1000).toISOString();
    const appUrl = Deno.env.get('APP_URL') || '';
    const sb = adminClient();

    // Side-effect emails must respect the test-mode gate: while Stripe is in
    // test mode a cron must not mail real studios. This was sending straight
    // through mailgun, which meant a test-mode run reached live inboxes.
    const { data: paySettings } = await sb.from('payment_settings')
      .select('stripe_mode').eq('id', 1).maybeSingle();
    const sendGated = createGatedSender({
      isLive: (paySettings?.stripe_mode || 'test') === 'live',
      testRecipient: Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '',
    });

    const { data: rows, error } = await sb.from('submissions')
      .select('id, studio_name, contact_email, region, plan, payment_status, kb_completed_at, kb_abandonment_nudged_at, kb_scrape_completed_at')
      .eq('plan', 'ai')
      .in('payment_status', PAID_STATUSES)
      .is('kb_completed_at', null)
      .is('kb_abandonment_nudged_at', null)
      .lt('kb_scrape_completed_at', cutoff)
      .order('kb_scrape_completed_at', { ascending: true })
      .limit(MAX_PER_RUN);
    if (error) throw error;

    const candidates = rows || [];
    const results: Array<{ id: string; email: string; ok: boolean; error?: string }> = [];

    for (const r of candidates) {
      if (!r.contact_email) continue;
      const region = String(r.region || 'AU').toUpperCase();
      const resumeUrl = `${appUrl}/setup/?plan=ai&region=${region}`;
      const studioName = r.studio_name || 'there';

      if (dryRun) {
        results.push({ id: r.id, email: r.contact_email, ok: true });
        continue;
      }

      // KB abandonment nudges are an OPTIONAL intent under the studio
      // email opt-out (migration 039). A muted studio is by definition
      // not interested in nudges, so skip cleanly without counting as
      // a failure.
      const prefs = await loadStudioEmailPrefs(sb, r.id);
      if (prefs && !prefs.enabled) {
        results.push({ id: r.id, email: r.contact_email, ok: true, error: 'opted_out' });
        continue;
      }

      try {
        const t = kbAbandonmentNudge({ studioName, resumeUrl });
        const unsubUrl = unsubscribeUrl(prefs?.token);
        const finalHtml = unsubUrl ? injectUnsubscribeFooter(t.html, unsubUrl) : t.html;
        await sendGated({
          to: r.contact_email,
          subject: t.subject,
          html: finalHtml,
          replyTo: 'info@studiolabsoftware.com',
          intent: 'kb-abandonment-nudge',
        });
        const stampedAt = new Date().toISOString();
        await sb.from('submissions')
          .update({ kb_abandonment_nudged_at: stampedAt })
          .eq('id', r.id);
        await sb.from('activity_log').insert({
          submission_id: r.id,
          action: 'kb_abandonment_nudge_sent',
          actor: 'system',
          details: { resume_url: resumeUrl },
        });
        results.push({ id: r.id, email: r.contact_email, ok: true });
      } catch (err) {
        console.error('nudge-abandoned-kb send failed for', r.id, err);
        results.push({ id: r.id, email: r.contact_email, ok: false, error: String(err) });
      }
    }

    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      considered: candidates.length,
      sent: results.filter((x) => x.ok && !dryRun).length,
      failed: results.filter((x) => !x.ok).length,
      results,
    });
  } catch (err) {
    console.error('nudge-abandoned-kb error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
