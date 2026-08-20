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
// It also escalates to a human, because email alone cannot solve an email
// problem. See ESCALATE_AFTER_HOURS below.
//
// SCOPE NOTE, and it is the important one. This reaches studios who have a
// draft, meaning they got to the form and verified their email at least once.
// It does NOT reach a studio who signed up and never opened the form: those
// leave no row in public.submissions at all, so from here they are invisible,
// and they are precisely the population most at risk (invite went to junk, or
// never arrived).
//
// That gap is NOT solved by writing more code here. The Connector already has
// both halves built: missed-signup-sweep reconciles live sub-accounts against
// inbound_signup and sends the invite to anyone missed, and
// mailgun-event-webhook records delivery events. Neither is deployed and their
// tables (growth_manager.inbound_signup, growth_manager.email_event) do not
// exist in the database. Deploy those rather than rebuilding them here; the
// only work left on this side is a second pass over inbound_signup rows with
// no matching submission.
//
// Invoked by pg_cron. The caller must present CRON_SECRET as a Bearer token;
// without it the function refuses to run, so this cannot be triggered from the
// public web.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { loadStudioEmailPrefs, unsubscribeUrl, injectUnsubscribeFooter } from '../_shared/studio-email.ts';
import { onboardingNudge, onboardingEscalation } from '../_shared/email-templates.ts';
import { resolveAdminNotificationRecipients } from '../_shared/admin-recipients.ts';
import { lookupDeliveryStatus } from '../_shared/mailgun-events.ts';

const MAX_NUDGES = 3;

const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };

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

// Chasing the studio is not enough on its own. The ones most at risk are the
// ones our email never reached, and from our side they look identical to the
// ones who ignored it. After a week with no movement a human is told, with the
// delivery status, so the follow-up can be a phone call instead of a fourth
// email. A confirmed bounce or spam complaint escalates immediately: at that
// point we know no amount of emailing will work.
const ESCALATE_AFTER_HOURS = 168; // 7 days

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

    // ── Escalation ─────────────────────────────────────────────────────────
    // Separate query rather than reusing the loop above: a studio is escalated
    // on age or on unreachability, which is not the same set as "due a nudge",
    // and it happens once per studio for good.
    const { data: stalled } = await sb.from('submissions')
      .select('id, studio_name, contact_email, region, plan, created_at, last_saved_at, onboarding_nudge_count, onboarding_escalated_at')
      .eq('status', 'draft')
      .eq('payment_status', 'unpaid')
      .is('onboarding_escalated_at', null)
      .order('created_at', { ascending: true })
      .limit(MAX_PER_RUN);

    const escalations: Array<{ id: string; ok: boolean; reason?: string; error?: string }> = [];
    const adminRecipients = await resolveAdminNotificationRecipients(sb, isLive);

    for (const r of stalled || []) {
      if (!r.contact_email) continue;
      const ageHours = hoursSince(r.created_at);
      const nudges = Number(r.onboarding_nudge_count || 0);

      // Only ask Mailgun about studios we have actually emailed. Nothing has
      // been sent to the rest, so there is no delivery to look up.
      const delivery = nudges > 0
        ? await lookupDeliveryStatus(r.contact_email)
        : { delivered: false, opened: false, bounced: false, complained: false, known: false, summary: 'No follow-up sent yet' };
      const unreachable = delivery.bounced || delivery.complained;

      if (!unreachable && ageHours < ESCALATE_AFTER_HOURS) continue;
      if (adminRecipients.length === 0) break;

      const reason = unreachable ? 'unreachable' : 'stalled_7d';
      if (dryRun) { escalations.push({ id: r.id, ok: true, reason }); continue; }

      try {
        const t = onboardingEscalation({
          studioName: r.studio_name || 'Unnamed studio',
          contactEmail: r.contact_email,
          plan: PLAN_LABEL[String(r.plan || '').toLowerCase()] || String(r.plan || 'unknown'),
          region: String(r.region || 'AU').toUpperCase(),
          daysSinceSignup: Math.max(1, Math.round(ageHours / 24)),
          nudgesSent: nudges,
          deliverySummary: delivery.summary,
          unreachable,
          adminUrl: `${Deno.env.get('ADMIN_APP_URL') || ''}?id=${r.id}`,
        });
        await send({
          to: adminRecipients,
          subject: t.subject,
          html: t.html,
          replyTo: 'info@studiolabsoftware.com',
          intent: `onboarding-escalation-${reason}`,
        });
        await sb.from('submissions')
          .update({ onboarding_escalated_at: new Date().toISOString() })
          .eq('id', r.id);
        await sb.from('activity_log').insert({
          submission_id: r.id,
          action: 'onboarding_escalated',
          actor: 'system',
          details: { reason, days: Math.round(ageHours / 24), delivery: delivery.summary },
        });
        escalations.push({ id: r.id, ok: true, reason });
      } catch (err) {
        console.error('nudge-abandoned-onboarding escalation failed for', r.id, err);
        escalations.push({ id: r.id, ok: false, reason, error: String(err) });
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
      escalated: escalations.filter((x) => x.ok && !dryRun).length,
      escalations,
      results,
    });
  } catch (err) {
    console.error('nudge-abandoned-onboarding error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
