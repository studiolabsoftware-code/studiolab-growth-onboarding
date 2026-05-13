// Save edits the studio makes on the post-payment KB intake page. A thin
// wrapper around an UPDATE on the kb_* columns plus the persona fields,
// with a server-side allowlist so the client can never push columns it
// shouldn't. Marks the source for each edited field as 'edited' in
// kb_scrape_sources so the per-field badges flip from "website" / "default"
// to "edited" and so any future re-scan (if we add it) skips edited fields.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { defaultGreeting } from '../_shared/kb-defaults.ts';

const ALLOWED = new Set([
  'kb_assistant_persona_type',
  'kb_assistant_persona_name',
  'kb_greeting',
  'kb_profile',
  'kb_classes',
  'kb_pricing',
  'kb_price_quoting',
  'kb_policies',
  'kb_events',
  'kb_faqs',
  'kb_restricted',
  'kb_tone',
  'voice_hours',
  'voice_escalate',
]);

const SOURCE_TRACKED = [
  'kb_greeting', 'kb_profile', 'kb_classes', 'kb_pricing', 'kb_price_quoting',
  'kb_policies', 'kb_events', 'kb_faqs', 'kb_tone', 'voice_hours',
];

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : '';
    const finalize = body.finalize === true;
    const payload = (body.payload && typeof body.payload === 'object') ? body.payload as Record<string, unknown> : {};
    if (!sessionToken) return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);

    const sb = adminClient();
    const sessionHash = await sha256Hex(sessionToken);
    const { data: row, error: lookupErr } = await sb.from('submissions')
      .select('id, plan, payment_status, studio_name, kb_scrape_sources, kb_assistant_persona_type, kb_assistant_persona_name, kb_greeting, session_expires_at')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!row) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!row.session_expires_at || new Date(row.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired.' }, 401);
    }
    if (row.plan !== 'ai') return jsonResponse({ ok: false, error: 'Not an AI-plan submission.' }, 400);

    // Validate persona type if present.
    if (payload.kb_assistant_persona_type !== undefined
      && payload.kb_assistant_persona_type !== 'studio'
      && payload.kb_assistant_persona_type !== 'named') {
      return jsonResponse({ ok: false, error: 'Invalid persona type.' }, 400);
    }

    // Build the update. Treat empty string as null so the column can be
    // cleared. Track which fields the studio actually changed so we can
    // update kb_scrape_sources to 'edited' for those.
    const update: Record<string, unknown> = {};
    const editedFields = new Set<string>();
    for (const [k, v] of Object.entries(payload)) {
      if (!ALLOWED.has(k)) continue;
      const newVal = v === '' ? null : v;
      update[k] = newVal;
      editedFields.add(k);
    }

    // Greeting auto-regenerates when the persona changes and the studio
    // hasn't manually edited the greeting in this same payload.
    const personaChanged = editedFields.has('kb_assistant_persona_type') || editedFields.has('kb_assistant_persona_name');
    if (personaChanged && !editedFields.has('kb_greeting')) {
      const nextType = (update.kb_assistant_persona_type as 'studio' | 'named' | null)
        ?? (row.kb_assistant_persona_type as 'studio' | 'named' | null)
        ?? 'studio';
      const nextName = (update.kb_assistant_persona_name as string | null)
        ?? (row.kb_assistant_persona_name as string | null);
      update.kb_greeting = defaultGreeting({
        studioName: row.studio_name || 'the studio',
        personaType: nextType,
        personaName: nextName,
      });
    }

    // Roll the source map forward — fields the studio touched become 'edited'.
    const sources = (row.kb_scrape_sources && typeof row.kb_scrape_sources === 'object'
      ? { ...(row.kb_scrape_sources as Record<string, string>) }
      : {}) as Record<string, 'website' | 'default' | 'edited'>;
    for (const k of SOURCE_TRACKED) {
      if (editedFields.has(k)) sources[k] = 'edited';
    }
    update.kb_scrape_sources = sources;

    if (finalize) {
      // Mark the KB intake done. We do not flip status here — the row is
      // already in 'submitted' from the Stripe webhook. The handoff flow
      // is what eventually moves it forward. We just record completion.
      update.kb_completed_at = new Date().toISOString();
    }

    const { error: updErr } = await sb.from('submissions').update(update).eq('id', row.id);
    if (updErr) throw updErr;

    if (finalize) {
      try {
        await sb.from('activity_log').insert({
          submission_id: row.id,
          action: 'note_added',
          actor: 'studio',
          details: { kind: 'kb_intake_completed' },
        });
      } catch (e) { console.error('activity_log insert failed:', e); }
      try {
        const { postSystemMessage } = await import('../_shared/inbox.ts');
        await postSystemMessage(sb, row.id, row.studio_name || null,
          '🤖 Studio confirmed their AI knowledge base — ready for the next step.');
      } catch (e) { console.error('system message (kb_complete) failed:', e); }
    }

    return jsonResponse({ ok: true, finalized: finalize });
  } catch (err) {
    console.error('save-kb error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
