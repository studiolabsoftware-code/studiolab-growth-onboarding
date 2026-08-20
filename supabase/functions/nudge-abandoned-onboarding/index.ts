// Daily follow-up for studios who signed up, opened the setup form and then
// stopped. Nothing chases them today: the draft just sits there unpaid and the
// studio never comes back, so the account we provisioned goes unused.
//
// Sends a short, finite sequence and then gives up:
//   nudge 1  ~3 days after their last activity
//   nudge 2  ~4 days after nudge 1   (roughly day 7)
//   nudge 3  ~7 days after nudge 2   (roughly day 14)
// After the third we stop. A fourth is nagging, and the draft keeps saving
// either way, so there is nothing to lose by leaving them alone.
//
// SCOPE NOTE. This covers studios who have a draft, which means they reached
// the form and verified their email at least once. It does NOT cover a studio
// who signed up and never opened the form at all: those leave no row in
// public.submissions, and the only record of them is
// growth_manager.inbound_signup, written by the Connector's
// signup-webhook-receiver. That function is built and green but not deployed,
// so that population does not exist in the database yet. When it ships, add a
// second pass here over inbound_signup rows with no matching submission.
//
// Invoked by pg_cron. The caller must present CRON_SECRET as a Bearer token;
// without it the function refuses to run, so this cannot be triggered from the
// public web.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { loadStudioEmailPrefs, unsubscribeUrl, injectUnsubscribeFooter } from '../_shared/studio-email.ts';
import { onboardingNudge } from '../_shared/email-templates.ts';

const MAX_NUDGES = 3;

// Hours of silence required before each nudge, indexed by how many have
// already gone out. Measured from their last activity for the first, and from
// the previous nudge for the rest.
const GAP_HOURS: Record<number, number> = {
  0: 72,   // 3 days since they last touched the form
  1: 96,   // 4 days since nudge 1
  2: 168,  // 7 days since nudge 2
};

// Defensive cap. A daily window should yield a handful of rows; a much larger
// batch means something upstream is wedged and we would rather log the count
// than blast a few hundred inboxes.
const MAX_PER_RUN = 200;

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected) return false;
  const authz = req.headers.get('Authorization') || '';
  return authz.replace(/^Bearer\s+/i, '').trim() === expected;
}

function hoursSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / (1000 * 60 * 60);
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  if (!isAuthorized(req)) {
    return jsonResponse({ ok: false, error: 'Unauthorized.' }, 401);
  }

  try {
    const dryRun = new URL(req.url).searchParams.get('dry_run') === '1';
    const appUrl = Deno.env.get('APP_URL') || '';
    const sb = adminClient();

    const { data: settings } = await sb.from('payment_settings')
      .select('stripe_mode').eq('id', 1).maybeSingle();
    const isLive = (settings?.stripe_mode || 'test') === 'live';
    const send = createGatedSender({
      isLive,
      testRecipient: Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '',
    });

    const { data: rows, error } = await sb.from('submissions')
      .select('id, studio_name, contact_email, region, plan, status, payment_status, created_at, last_saved_at, onboarding_nudge_count, onboarding_nudged_at')
      .eq('status', 'draft')
      .eq('payment_status', 'unpaid')
      .lt('onboarding_nudge_count', MAX_NUDGES)
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN);
    if (error) throw error;

    const results: Array<{ id: string; step?: number; ok: boolean; skipped?: string; error?: string }> = [];
    let considered = 0;

    for (const r of rows || []) {
      if (!r.contact_email) continue;

      const sent = Number(r.onboarding_nudge_count || 0);
      const gap = GAP_HOURS[sent];
      if (gap === undefined) continue;

      // First nudge times off their last activity; later ones off the previous
      // nudge. last_saved_at is null for a studio who verified their email and
      // then closed the tab without saving anything, so fall back to created_at.
      const since = sent === 0
        ? hoursSince(r.last_saved_at || r.created_at)
        : hoursSince(r.onboarding_nudged_at);
      if (since < gap) continue;

      considered++;
      const step = (sent + 1) as 1 | 2 | 3;
      const region = String(r.region || 'AU').toUpperCase();
      const plan = String(r.plan || 'launch').toLowerCase();
      // Route through /setup/ rather than straight at the plan URL: it resolves
      // the studio's draft after OTP and lands them on the right step, and it
      // is the same entry point the KB nudge already uses.
      const resumeUrl = `${appUrl}/setup/?plan=${encodeURIComponent(plan)}&region=${encodeURIComponent(region)}`;
      const studioName = r.studio_name || 'there';

      if (dryRun) {
        results.push({ id: r.id, step, ok: true });
        continue;
      }

      // Follow-ups are an OPTIONAL intent under the studio email opt-out
      // (migration 039). A muted studio is by definition not interested, so
      // skip cleanly rather than counting it as a failure.
      const prefs = await loadStudioEmailPrefs(sb, r.id);
      if (prefs && !prefs.enabled) {
        results.push({ id: r.id, ok: true, skipped: 'opted_out' });
        continue;
      }

      try {
        const t = onboardingNudge({ studioName, resumeUrl, step });
        const unsubUrl = unsubscribeUrl(prefs?.token);
        await send({
          to: r.contact_email,
          subject: t.subject,
          html: unsubUrl ? injectUnsubscribeFooter(t.html, unsubUrl) : t.html,
          replyTo: 'info@studiolabsoftware.com',
          intent: `onboarding-nudge-${step}`,
        });
        await sb.from('submissions')
          .update({
            onboarding_nudge_count: sent + 1,
            onboarding_nudged_at: new Date().toISOString(),
          })
          .eq('id', r.id);
        await sb.from('activity_log').insert({
          submission_id: r.id,
          action: 'onboarding_nudge_sent',
          actor: 'system',
          details: { step, resume_url: resumeUrl },
        });
        results.push({ id: r.id, step, ok: true });
      } catch (err) {
        console.error('nudge-abandoned-onboarding send failed for', r.id, err);
        results.push({ id: r.id, step, ok: false, error: String(err) });
      }
    }

    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      scanned: (rows || []).length,
      due: considered,
      sent: results.filter((x) => x.ok && !x.skipped && !dryRun).length,
      skipped: results.filter((x) => x.skipped).length,
      failed: results.filter((x) => !x.ok).length,
      results,
    });
  } catch (err) {
    console.error('nudge-abandoned-onboarding error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
