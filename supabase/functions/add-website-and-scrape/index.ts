// Manual scrape trigger from inside the post-payment KB intake page. Used
// when the studio reached Pay-click without a website URL on file — the KB
// page shows a "Add your website now and we'll pre-fill everything" callout,
// and clicking the button calls here.
//
// Single-use: a submission whose kb_scrape_status is already 'complete' or
// 'pending' is rejected. Studios get one scrape; everything else is editing.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : '';
    const rawWebsite = typeof body.website === 'string' ? body.website.trim() : '';
    if (!sessionToken) return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);
    if (!rawWebsite) return jsonResponse({ ok: false, error: 'Website URL is required.' }, 400);

    // Light URL sanity check. The scrape function does the full normalisation.
    const candidate = /^https?:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`;
    let normalised: string;
    try { normalised = new URL(candidate).toString(); }
    catch { return jsonResponse({ ok: false, error: 'That does not look like a valid website URL.' }, 400); }

    const sb = adminClient();
    const sessionHash = await sha256Hex(sessionToken);
    const { data: row, error: lookupErr } = await sb.from('submissions')
      .select('id, plan, kb_scrape_status, session_expires_at')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!row) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!row.session_expires_at || new Date(row.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired.' }, 401);
    }
    if (row.plan !== 'ai') {
      return jsonResponse({ ok: false, error: 'KB scrape is only available on the Dominate AI plan.' }, 400);
    }
    if (row.kb_scrape_status === 'pending' || row.kb_scrape_status === 'complete') {
      return jsonResponse({ ok: false, error: 'A knowledge-base scan has already run for this submission.' }, 409);
    }

    // Save the website on the row, then clear status so scrape-and-extract
    // will pick it up cleanly when invoked next.
    await sb.from('submissions').update({
      website: normalised,
      kb_scrape_status: null,
    }).eq('id', row.id);

    // Invoke the scrape function. Use the Supabase admin client so the
    // request is authenticated as service-role; the scrape function still
    // looks up the row by session_token so the auth chain is consistent.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) throw new Error('Supabase env not set.');

    const invokeResp = await fetch(`${supabaseUrl}/functions/v1/scrape-and-extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ session_token: sessionToken }),
    });
    const invokeBody = await invokeResp.json().catch(() => ({}));
    if (!invokeResp.ok) {
      return jsonResponse({
        ok: false,
        error: (invokeBody as { error?: string }).error || 'Could not start the scan.',
      }, 502);
    }

    return jsonResponse({ ok: true, status: 'pending', website: normalised });
  } catch (err) {
    console.error('add-website-and-scrape error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
