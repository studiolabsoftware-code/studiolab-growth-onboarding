// Deletes a submission attachment — both the Storage object and the
// metadata row. Two auth paths:
//
//   * Admin JWT — admin can delete any attachment on any submission.
//   * Studio session_token — studio can delete attachments they uploaded
//     during their own active session, e.g. removing a file from the
//     form before submitting, or pulling back an attachment from a
//     message before the admin reads it.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'POST required.' }, 405);
    }
    const body = await req.json().catch(() => ({})) as { attachment_id?: string; session_token?: string };
    const attachmentId = (body.attachment_id || '').trim();
    const sessionToken = (body.session_token || '').trim();
    if (!attachmentId) {
      return jsonResponse({ ok: false, error: 'attachment_id is required.' }, 400);
    }

    const sb = adminClient();
    const { data: row } = await sb.from('submission_attachments')
      .select('id, submission_id, storage_path, file_name, uploaded_by_role, deliverable_id')
      .eq('id', attachmentId)
      .maybeSingle();
    if (!row) {
      return jsonResponse({ ok: true, skipped: 'already_gone' });
    }

    // For deliverable-scoped files, resolve the parent project so we can
    // record the deletion on the project timeline. Studio session_token
    // auth does not apply to deliverable files (those are admin-managed).
    let deliverableProjectId: string | null = null;
    if (row.deliverable_id) {
      const { data: deliv } = await sb.from('deliverables')
        .select('project_id')
        .eq('id', row.deliverable_id)
        .maybeSingle();
      deliverableProjectId = deliv?.project_id || null;
    }

    // ---- Auth
    let actor = 'unknown';
    const caller = await getCallerProfile(req);
    if (caller) {
      actor = `admin:${caller.email}`;
    } else if (sessionToken && row.submission_id) {
      const sessionHash = await sha256Hex(sessionToken);
      const { data: sub } = await sb.from('submissions')
        .select('id, session_expires_at')
        .eq('id', row.submission_id)
        .eq('session_token_hash', sessionHash)
        .maybeSingle();
      if (!sub || !sub.session_expires_at || new Date(sub.session_expires_at) < new Date()) {
        return jsonResponse({ ok: false, error: 'Your session does not match this submission.' }, 401);
      }
      // Studios can only delete files they uploaded themselves (not
      // admin-uploaded files on their submission).
      if (row.uploaded_by_role !== 'studio') {
        return jsonResponse({
          ok: false,
          error: 'This file was uploaded by our team and can only be removed by an admin.',
        }, 403);
      }
      actor = `studio:${sub.id}`;
    } else {
      return jsonResponse({ ok: false, error: 'Not authorised to delete this file.' }, 401);
    }

    // ---- Storage delete first, then DB row. If Storage fails we still
    // try to delete the DB row — better to have an orphaned Storage
    // object the cleanup cron picks up later than a phantom DB row the
    // admin UI keeps showing.
    const { error: storageErr } = await sb.storage
      .from('submission-attachments')
      .remove([row.storage_path]);
    if (storageErr) {
      console.error('storage delete failed (will still delete row):', storageErr);
    }

    const { error: rowErr } = await sb.from('submission_attachments')
      .delete()
      .eq('id', row.id);
    if (rowErr) {
      console.error('attachment row delete failed:', rowErr);
      return jsonResponse({
        ok: false,
        error: 'Could not remove the file. Please try again.',
      }, 500);
    }

    try {
      const isDeliverableScope = !!row.deliverable_id;
      await sb.from('activity_log').insert({
        submission_id: row.submission_id,
        project_id: isDeliverableScope ? deliverableProjectId : null,
        action: isDeliverableScope ? 'deliverable_file_removed' : 'attachment_deleted',
        actor,
        details: {
          attachment_id: row.id,
          file_name: row.file_name,
          deliverable_id: row.deliverable_id || null,
          storage_orphan: !!storageErr,
        },
      });
    } catch (e) { console.error('activity_log insert failed:', e); }

    return jsonResponse({ ok: true, deleted: { id: row.id, file_name: row.file_name } });
  } catch (err) {
    console.error('delete-submission-attachment error:', err);
    return jsonResponse({
      ok: false,
      error: 'Something went wrong on our end. Please try again.',
    }, 500);
  }
});
