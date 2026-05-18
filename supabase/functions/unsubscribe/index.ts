// Token-based studio email opt-out. Reached from the Unsubscribe link
// in every studio email's footer; explicitly does NOT require a
// session token or sign-in -- Australian Spam Act (and CAN-SPAM /
// GDPR equivalents) require the unsubscribe to be one-click-from-email
// without authentication.
//
// Two actions:
//   GET-style ?action=status&t=<token>  -> returns current opt-out state
//   POST  { action: 'set', token, enabled: bool } -> flips the flag
//
// The token is the stable per-submission unsubscribe_token from
// migration 039. It only unlocks ONE field (email_notifications_enabled)
// so blast radius is bounded if a link leaks.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    let action: string;
    let token: string;
    let enabledFromBody: boolean | undefined;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      action = String(url.searchParams.get('action') || 'status');
      token = String(url.searchParams.get('t') || '').trim();
    } else if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      action = String(body.action || 'set');
      token = String(body.token || '').trim();
      enabledFromBody = typeof body.enabled === 'boolean' ? body.enabled : undefined;
    } else {
      return jsonResponse({ ok: false, error: 'GET or POST only.' }, 405);
    }

    if (!token) return jsonResponse({ ok: false, error: 'Missing token.' }, 400);
    if (token.length < 16 || token.length > 200) {
      return jsonResponse({ ok: false, error: 'Invalid token.' }, 400);
    }

    const sb = adminClient();
    const { data: row, error: lookupErr } = await sb.from('submissions')
      .select('id, studio_name, contact_email, email_notifications_enabled')
      .eq('unsubscribe_token', token)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!row) {
      // Generic 404 -- do not leak whether a token is valid via timing
      // or error wording. From the user's POV both "expired" and "wrong"
      // read the same.
      return jsonResponse({ ok: false, error: 'This link is no longer valid.' }, 404);
    }

    if (action === 'status') {
      return jsonResponse({
        ok: true,
        studio_name: row.studio_name,
        contact_email: row.contact_email,
        enabled: row.email_notifications_enabled !== false,
      });
    }

    if (action === 'set') {
      // Default to opt-OUT when the action is set without explicit
      // boolean -- the link in the email is an "unsubscribe me" intent.
      const next = enabledFromBody === undefined ? false : enabledFromBody;
      const { error: updErr } = await sb.from('submissions')
        .update({ email_notifications_enabled: next })
        .eq('id', row.id);
      if (updErr) throw updErr;

      // Best-effort audit row so admin has a paper trail of opt-outs.
      try {
        await sb.from('activity_log').insert({
          submission_id: row.id,
          action: next ? 'studio_email_resubscribed' : 'studio_email_unsubscribed',
          actor: row.contact_email || 'studio',
          details: { via: 'unsubscribe_token' },
        });
      } catch (e) { console.error('activity log insert failed:', e); }

      return jsonResponse({
        ok: true,
        studio_name: row.studio_name,
        contact_email: row.contact_email,
        enabled: next,
      });
    }

    return jsonResponse({ ok: false, error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('unsubscribe error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
