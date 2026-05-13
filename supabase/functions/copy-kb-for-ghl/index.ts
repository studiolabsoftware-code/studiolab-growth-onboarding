// Admin endpoint. Returns the formatted Markdown KB document for a paid
// submission, ready to paste into the GHL Conversation AI knowledge base.
// Admin-auth only.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { buildKbMarkdown } from '../_shared/kb-md-export.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Not authorised.' }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const submissionId = typeof body.submission_id === 'string' ? body.submission_id : '';
    if (!submissionId) return jsonResponse({ ok: false, error: 'submission_id required.' }, 400);

    const sb = adminClient();
    const { data, error } = await sb.from('submissions')
      .select(
        'id, studio_name, legal_name, website, ' +
        'kb_assistant_persona_type, kb_assistant_persona_name, kb_greeting, ' +
        'kb_profile, kb_classes, kb_pricing, kb_price_quoting, kb_policies, ' +
        'kb_events, kb_faqs, kb_restricted, kb_tone, voice_hours, voice_escalate, ' +
        'plan',
      )
      .eq('id', submissionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return jsonResponse({ ok: false, error: 'Submission not found.' }, 404);
    if (data.plan !== 'ai') {
      return jsonResponse({ ok: false, error: 'KB export is only available for Dominate AI plan submissions.' }, 400);
    }

    const markdown = buildKbMarkdown({
      studioName: data.studio_name || 'Studio',
      legalName: data.legal_name,
      websiteUrl: data.website,
      greeting: data.kb_greeting,
      profile: data.kb_profile,
      classes: data.kb_classes,
      pricing: data.kb_pricing,
      priceQuoting: data.kb_price_quoting,
      policies: data.kb_policies,
      events: data.kb_events,
      faqs: data.kb_faqs,
      tone: data.kb_tone,
      voiceHours: data.voice_hours,
      voiceEscalate: data.voice_escalate,
      restricted: data.kb_restricted,
      personaType: data.kb_assistant_persona_type as 'studio' | 'named' | null,
      personaName: data.kb_assistant_persona_name,
    });

    return jsonResponse({ ok: true, markdown, filename: `${(data.studio_name || 'studio').replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-kb.md` });
  } catch (err) {
    console.error('copy-kb-for-ghl error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
