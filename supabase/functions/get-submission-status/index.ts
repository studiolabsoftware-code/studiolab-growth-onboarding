// Polling endpoint for the post-payment confirmation page. Returns just enough
// of the submission for the page to decide whether payment has landed and where
// to send the studio next.
//
// Replaces get-kb-status, which did this job under a misleading name: it was
// built for the knowledge-base intake page and carried every kb_* value with
// it. StudioLAB Growth now builds and populates the AI knowledge base itself,
// so that page and those columns are gone from the flow, but the payment poll
// they were bolted onto still has to work.
//
// Authenticated by the studio's session_token, which the payment step re-issues
// so a returning studio can resume.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : '';
    if (!sessionToken) return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);

    const sb = adminClient();
    const sessionHash = await sha256Hex(sessionToken);
    const { data, error } = await sb.from('submissions')
      .select('id, plan, region, status, payment_status, studio_name, invoice_hosted_url, session_expires_at')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!data.session_expires_at || new Date(data.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired.' }, 401);
    }

    return jsonResponse({
      ok: true,
      submission: {
        id: data.id,
        plan: data.plan,
        region: data.region,
        status: data.status,
        payment_status: data.payment_status,
        studio_name: data.studio_name,
        invoice_hosted_url: data.invoice_hosted_url,
      },
    });
  } catch (err) {
    console.error('get-submission-status error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
