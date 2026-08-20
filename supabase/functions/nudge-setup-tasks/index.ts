// Daily nudge for studios with outstanding Setup Checklist tiles. Sends a
// friendly summary email listing what's still open with a link back to
// /account.html. Throttle is 5 days between sends per studio; never sends
// more often. Cadence is intentionally gentle — Setup Checklist is the
// "we're not the wall" surface, so emails should feel like a polite tap on
// the shoulder, not a chase.
//
// Invoked by a scheduled job (Supabase pg_cron or external scheduler).
// CRON_SECRET as Bearer header required, matching the other cron jobs.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { loadStudioEmailPrefs, unsubscribeUrl, injectUnsubscribeFooter } from '../_shared/studio-email.ts';
import { setupChecklistNudge } from '../_shared/email-templates.ts';

const PAID_STATUSES = ['paid', 'authorised', 'card_saved'];
const OPEN_TILE_STATUSES = ['submitted', 'no_account', 'in_progress', 'pending'];
// The pending status is included because pending tiles ARE the most
// important nudge target — studios who haven't opened them yet. But we
// want to give them a window after payment first (don't email them the
// same day they pay), so we also enforce min hours since payment.
const MIN_HOURS_SINCE_PAYMENT = 48;
const MIN_DAYS_BETWEEN_NUDGES = 5;
const MAX_PER_RUN = 200;

const SURFACE_LABEL: Record<string, string> = {
  gbp: 'Google Business Profile',
  ga4: 'Google Analytics 4',
  gsc: 'Google Search Console',
  gtm: 'Google Tag Manager',
  google_ads: 'Google Ads',
  meta: 'Meta Business Manager',
  tiktok: 'TikTok Business Center',
  sms_a2p: 'SMS compliance & registration',
  whatsapp: 'WhatsApp Business',
};

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
    const nowMs = Date.now();
    const paymentCutoffIso = new Date(nowMs - MIN_HOURS_SINCE_PAYMENT * 60 * 60 * 1000).toISOString();
    const nudgeCutoffIso = new Date(nowMs - MIN_DAYS_BETWEEN_NUDGES * 24 * 60 * 60 * 1000).toISOString();

    // Candidate studios: paid more than 48h ago + not nudged in the last
    // 5 days (or never nudged at all). We fetch the full set then
    // filter for actually-open tiles in a second query (cheap, small
    // candidate set).
    const { data: candidates, error } = await sb.from('submissions')
      .select('id, studio_name, contact_email, payment_status, paid_at, captured_at, card_saved_at, setup_last_nudge_at, setup_nudge_count')
      .in('payment_status', PAID_STATUSES)
      .lte('paid_at', paymentCutoffIso)
      .or(`setup_last_nudge_at.is.null,setup_last_nudge_at.lt.${nudgeCutoffIso}`)
      .order('paid_at', { ascending: true })
      .limit(MAX_PER_RUN);
    if (error) throw error;

    const results: Array<{ id: string; email: string; ok: boolean; open_count?: number; error?: string }> = [];
    for (const r of (candidates || [])) {
      if (!r.contact_email) continue;
      const { data: openTiles } = await sb.from('setup_tasks')
        .select('surface')
        .eq('submission_id', r.id)
        .in('status', OPEN_TILE_STATUSES);
      const openSurfaces = (openTiles || []).map((t) => SURFACE_LABEL[t.surface] || t.surface);
      if (!openSurfaces.length) {
        // All complete or no_account-resolved — nothing to nudge about.
        results.push({ id: r.id, email: r.contact_email, ok: true, open_count: 0, error: 'all_complete' });
        continue;
      }

      if (dryRun) {
        results.push({ id: r.id, email: r.contact_email, ok: true, open_count: openSurfaces.length });
        continue;
      }

      // Respect global studio email opt-out.
      const prefs = await loadStudioEmailPrefs(sb, r.id);
      if (prefs && !prefs.enabled) {
        results.push({ id: r.id, email: r.contact_email, ok: true, open_count: openSurfaces.length, error: 'opted_out' });
        continue;
      }

      try {
        const accountUrl = `${appUrl}/account.html`;
        const t = setupChecklistNudge({
          studioName: r.studio_name || 'there',
          openSurfaces,
          accountUrl,
          isFirstNudge: (r.setup_nudge_count || 0) === 0,
        });
        const unsubUrl = unsubscribeUrl(prefs?.token);
        const finalHtml = unsubUrl ? injectUnsubscribeFooter(t.html, unsubUrl) : t.html;
        await sendGated({
          to: r.contact_email,
          subject: t.subject,
          html: finalHtml,
          replyTo: 'info@studiolabsoftware.com',
          intent: 'setup-task-nudge',
        });
        const stampedAt = new Date().toISOString();
        await sb.from('submissions')
          .update({
            setup_last_nudge_at: stampedAt,
            setup_nudge_count: (r.setup_nudge_count || 0) + 1,
          })
          .eq('id', r.id);
        await sb.from('activity_log').insert({
          submission_id: r.id,
          action: 'setup_checklist_nudge_sent',
          actor: 'system',
          details: { open_surfaces: openSurfaces, nudge_count: (r.setup_nudge_count || 0) + 1 },
        });
        results.push({ id: r.id, email: r.contact_email, ok: true, open_count: openSurfaces.length });
      } catch (err) {
        console.error('nudge-setup-tasks send failed for', r.id, err);
        results.push({ id: r.id, email: r.contact_email, ok: false, open_count: openSurfaces.length, error: String(err) });
      }
    }

    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      considered: (candidates || []).length,
      sent: results.filter((x) => x.ok && !dryRun && x.open_count && x.open_count > 0 && !x.error).length,
      failed: results.filter((x) => !x.ok).length,
      results,
    });
  } catch (err) {
    console.error('nudge-setup-tasks error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
