// Lists form-context attachments for a single submission. Used by the
// onboarding form to rehydrate previously uploaded files when a studio
// returns to a draft, and by the admin detail page in future if needed.
//
// Auth: admin JWT OR studio session_token. The studio path requires the
// session to match the requested submission_id.
//
// Scope: returns rows where message_id IS NULL — i.e. attachments
// uploaded against the form itself, not against a message thread. The
// inbox composer (Phase 2B) lists its own attachments through the
// message-thread fetch, so this endpoint is intentionally form-only.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'POST required.' }, 405);
    }
    const body = await req.json().catch(() => ({})) as {
      submission_id?: string;
      session_token?: string;
    };
    const submissionId = (body.submission_id || '').trim();
    const sessionToken = (body.session_token || '').trim();
    if (!submissionId) {
      return jsonResponse({ ok: false, error: 'submission_id is required.' }, 400);
    }

    const sb = adminClient();

    // ---- Auth: admin JWT OR studio session_token matching the submission
    let authorised = false;
    const caller = await getCallerProfile(req);
    if (caller) {
      authorised = true;
    } else if (sessionToken) {
      const sessionHash = await sha256Hex(sessionToken);
      const { data: sub } = await sb.from('submissions')
        .select('id, session_expires_at')
        .eq('id', submissionId)
        .eq('session_token_hash', sessionHash)
        .maybeSingle();
      if (sub && sub.session_expires_at && new Date(sub.session_expires_at) > new Date()) {
        authorised = true;
      }
    }
    if (!authorised) {
      return jsonResponse({ ok: false, error: 'Not authorised to list attachments.' }, 401);
    }

    const { data, error } = await sb.from('submission_attachments')
      .select('id, file_name, mime_type, size_bytes, uploaded_at, expires_at, uploaded_by_role')
      .eq('submission_id', submissionId)
      .is('message_id', null)
      .order('uploaded_at', { ascending: true });

    if (error) {
      console.error('list-submission-attachments query failed:', error);
      return jsonResponse({
        ok: false,
        error: 'Could not load attachments. Please refresh and try again.',
      }, 500);
    }

    return jsonResponse({ ok: true, attachments: data || [] });
  } catch (err) {
    console.error('list-submission-attachments error:', err);
    return jsonResponse({
      ok: false,
      error: 'Something went wrong on our end. Please try again.',
    }, 500);
  }
});
