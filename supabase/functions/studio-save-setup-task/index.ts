// Studio Setup Checklist — per-tile save endpoint.
//
// The studio writes their access-delegation info (URLs, IDs) for a single
// tile in the Setup Checklist. Auth is the same session_token used by
// /account.html (get-studio-account, save-draft). Anon-callable
// (deployed --no-verify-jwt) — verification happens via session-token
// hash lookup against submissions.
//
// On submission we:
//   * Validate the surface key against the allowlist
//   * Validate the data shape (per-surface keys)
//   * Update the setup_tasks row (or insert it if somehow missing)
//   * Post a system message into the studio's conversation thread so
//     admins see "Studio submitted GBP access details" in the inbox
//   * Return the updated task row

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { postSystemMessage } from '../_shared/inbox.ts';
import { VALID_SURFACES, VALID_STATUSES, cleanTaskData, taskMessage, type SurfaceKey, type StatusKey } from '../_shared/setup-task-rules.ts';


Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : '';
    const surface = typeof body.surface === 'string' ? body.surface : '';
    const status = typeof body.status === 'string' ? body.status : '';
    const data = (body.data && typeof body.data === 'object') ? body.data as Record<string, unknown> : {};

    if (!sessionToken) return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);
    if (!VALID_SURFACES.has(surface as SurfaceKey)) {
      return jsonResponse({ ok: false, error: 'Unknown surface key.' }, 400);
    }
    if (!VALID_STATUSES.has(status as StatusKey)) {
      return jsonResponse({ ok: false, error: 'Invalid status.' }, 400);
    }

    const sb = adminClient();
    const sessionHash = await sha256Hex(sessionToken);

    const { data: submission } = await sb.from('submissions')
      .select('id, studio_name, payment_status, session_expires_at')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    if (!submission) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!submission.session_expires_at || new Date(submission.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired.' }, 401);
    }
    // Block writes from unpaid studios — the tile UI shouldn't render for
    // them, but the server enforces the same rule independently.
    const PAID_STATUSES = new Set(['paid', 'authorised', 'card_saved']);
    if (!PAID_STATUSES.has(String(submission.payment_status))) {
      return jsonResponse({ ok: false, error: 'Setup checklist is unlocked after payment.' }, 403);
    }

    const cleanData = cleanTaskData(surface as SurfaceKey, data);

    // Upsert the row. On status='submitted' we stamp studio_submitted_at
    // the first time only — don't keep moving it every resubmit.
    const nowIso = new Date().toISOString();
    const { data: existing } = await sb.from('setup_tasks')
      .select('id, status, studio_submitted_at')
      .eq('submission_id', submission.id)
      .eq('surface', surface)
      .maybeSingle();

    const wasOpenForSubmission = !existing || existing.status === 'pending' || existing.status === 'no_account';
    const studioSubmittedAt = status === 'submitted'
      ? (existing?.studio_submitted_at || nowIso)
      : existing?.studio_submitted_at || null;

    const upsertRow = {
      submission_id: submission.id,
      surface,
      status,
      data: cleanData,
      studio_submitted_at: studioSubmittedAt,
    };

    const { data: saved, error: saveErr } = await sb.from('setup_tasks')
      .upsert(upsertRow, { onConflict: 'submission_id,surface' })
      .select('id, surface, status, data, studio_submitted_at, admin_started_at, completed_at, updated_at')
      .single();
    if (saveErr || !saved) throw saveErr || new Error('Failed to save setup task.');

    // Post a system message in the studio's inbox thread so an admin sees
    // the submission in their workflow. Only do this on a real status
    // transition into submitted/no_account (not on every save).
    if (wasOpenForSubmission && (status === 'submitted' || status === 'no_account')) {
      const text = taskMessage(surface as SurfaceKey, status);
      await postSystemMessage(sb, submission.id, submission.studio_name, text);
    }

    return jsonResponse({ ok: true, task: saved });
  } catch (err) {
    console.error('studio-save-setup-task error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
