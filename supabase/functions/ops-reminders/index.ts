// Standing internal reminders for tasks only a human can do, plus the one-click
// endpoint that closes them.
//
// Two entry points on one function:
//   POST (CRON_SECRET bearer)  run the daily sweep, email anything that is due
//   GET  ?done=<token>         close one reminder, from the link in its email
//
// The GET is deliberately unauthenticated beyond the token. It is reachable
// from an email client with no session, which is the entire point, and the
// worst a leaked token can do is stop a reminder the owner was going to close
// anyway. Tokens are 24 random bytes and single-purpose.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { resolveAdminNotificationRecipients } from '../_shared/admin-recipients.ts';
import { opsReminder } from '../_shared/email-templates.ts';

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET');
  if (!expected) return false;
  const authz = req.headers.get('Authorization') || '';
  return authz.replace(/^Bearer\s+/i, '').trim() === expected;
}

function page(title: string, message: string): Response {
  // Plain HTML rather than JSON: this is opened in a browser from an email.
  const html = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F2F3F7;
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Arial,sans-serif;color:#13102E}
  .c{background:#fff;border:1px solid #DFE0EC;border-radius:14px;padding:34px 32px;max-width:440px;
     margin:24px;box-shadow:0 4px 24px rgba(19,16,46,.06)}
  h1{margin:0 0 10px;font-size:21px;letter-spacing:-.3px}
  p{margin:0;color:#4A4C65;line-height:1.6;font-size:15px}
</style>
<div class="c"><h1>${title}</h1><p>${message}</p></div>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;

  const url = new URL(req.url);
  const doneToken = url.searchParams.get('done');

  // ── One-click close, straight from the email ──────────────────────────────
  if (req.method === 'GET' && doneToken) {
    try {
      const sb = adminClient();
      const { data: row } = await sb.from('ops_reminders')
        .select('id, key, title, active')
        .eq('done_token', doneToken)
        .maybeSingle();
      if (!row) {
        return page('Link not recognised', 'That link is not valid. It may have already been used and replaced, or the reminder may have been removed.');
      }
      if (!row.active) {
        return page('Already done', `"${row.title}" was already marked as done. Nothing further to do.`);
      }
      await sb.from('ops_reminders')
        .update({ active: false, completed_at: new Date().toISOString() })
        .eq('id', row.id);
      return page('Marked as done', `"${row.title}" is closed. You will not be reminded about it again.`);
    } catch (err) {
      console.error('ops-reminders done error:', err);
      return page('Something went wrong', 'We could not close that reminder. Try the link again in a moment.');
    }
  }

  // ── Daily sweep ───────────────────────────────────────────────────────────
  if (!isAuthorized(req)) {
    return jsonResponse({ ok: false, error: 'Unauthorized.' }, 401);
  }

  try {
    const dryRun = url.searchParams.get('dry_run') === '1';
    const fnBase = `${Deno.env.get('SUPABASE_URL') || ''}/functions/v1/ops-reminders`;
    const sb = adminClient();

    const { data: settings } = await sb.from('payment_settings')
      .select('stripe_mode').eq('id', 1).maybeSingle();
    const isLive = (settings?.stripe_mode || 'test') === 'live';
    const send = createGatedSender({
      isLive,
      testRecipient: Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '',
    });

    const recipients = await resolveAdminNotificationRecipients(sb, isLive);
    if (recipients.length === 0) {
      return jsonResponse({ ok: true, sent: 0, note: 'no admin recipients configured' });
    }

    const { data: rows, error } = await sb.from('ops_reminders')
      .select('id, key, title, body, interval_days, last_sent_at, done_token')
      .eq('active', true);
    if (error) throw error;

    const now = Date.now();
    const results: Array<{ key: string; ok: boolean; error?: string }> = [];

    for (const r of rows || []) {
      const gapMs = Math.max(1, Number(r.interval_days || 2)) * 86400_000;
      const last = r.last_sent_at ? new Date(r.last_sent_at).getTime() : 0;
      if (last && now - last < gapMs) continue;

      if (dryRun) { results.push({ key: r.key, ok: true }); continue; }

      // Count is derived from how many gaps have elapsed rather than stored,
      // since the exact number only decorates the subject line.
      const sentCount = last ? Math.max(2, Math.round((now - new Date(r.last_sent_at!).getTime()) / gapMs) + 1) : 1;
      try {
        const t = opsReminder({
          title: r.title,
          body: r.body,
          doneUrl: `${fnBase}?done=${encodeURIComponent(r.done_token)}`,
          sentCount,
        });
        await send({
          to: recipients,
          subject: t.subject,
          html: t.html,
          replyTo: 'info@studiolabsoftware.com',
          intent: `ops-reminder-${r.key}`,
        });
        await sb.from('ops_reminders')
          .update({ last_sent_at: new Date().toISOString() })
          .eq('id', r.id);
        results.push({ key: r.key, ok: true });
      } catch (err) {
        console.error('ops-reminders send failed for', r.key, err);
        results.push({ key: r.key, ok: false, error: String(err) });
      }
    }

    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      active: (rows || []).length,
      due: results.length,
      sent: results.filter((x) => x.ok && !dryRun).length,
      failed: results.filter((x) => !x.ok).length,
      results,
    });
  } catch (err) {
    console.error('ops-reminders error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
