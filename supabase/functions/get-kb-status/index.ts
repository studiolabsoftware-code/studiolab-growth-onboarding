// Polling endpoint for the post-payment KB intake page. Returns the
// submission's KB scrape status, all kb_* values, and the per-field source
// map so the page can render "Found on your website" vs "Standard default"
// badges. Authenticated by the studio's session_token (re-issued by the
// payment-confirm step so a returning studio can resume).

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
      .select(
        'id, plan, payment_status, studio_name, website, ' +
        'kb_assistant_persona_type, kb_assistant_persona_name, kb_greeting, ' +
        'kb_profile, kb_classes, kb_pricing, kb_price_quoting, kb_policies, ' +
        'kb_events, kb_faqs, kb_restricted, kb_tone, voice_hours, voice_escalate, ' +
        'kb_scrape_status, kb_scrape_completed_at, kb_scrape_pages_count, ' +
        'kb_scrape_sources, kb_scrape_error, session_expires_at',
      )
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
        payment_status: data.payment_status,
        studio_name: data.studio_name,
        website: data.website,
        kb_assistant_persona_type: data.kb_assistant_persona_type,
        kb_assistant_persona_name: data.kb_assistant_persona_name,
        kb_greeting: data.kb_greeting,
        kb_profile: data.kb_profile,
        kb_classes: data.kb_classes,
        kb_pricing: data.kb_pricing,
        kb_price_quoting: data.kb_price_quoting,
        kb_policies: data.kb_policies,
        kb_events: data.kb_events,
        kb_faqs: data.kb_faqs,
        kb_restricted: data.kb_restricted,
        kb_tone: data.kb_tone,
        voice_hours: data.voice_hours,
        voice_escalate: data.voice_escalate,
        kb_scrape_status: data.kb_scrape_status,
        kb_scrape_completed_at: data.kb_scrape_completed_at,
        kb_scrape_pages_count: data.kb_scrape_pages_count,
        kb_scrape_sources: data.kb_scrape_sources || {},
        kb_scrape_error: data.kb_scrape_error,
      },
    });
  } catch (err) {
    console.error('get-kb-status error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
