// Uploads a single file to the submission-attachments bucket and records
// the metadata row. Two auth paths:
//
//   1. Studio session_token — passed in form data as `session_token`.
//      Matched against submissions.session_token_hash; the resolved
//      submission_id is used (any submission_id in the form body must
//      match, else 403).
//
//   2. Admin Authorization JWT — verified via getCallerProfile.
//      submission_id comes from the form body; admin can upload against
//      any submission. uploaded_by_role='admin'.
//
// Storage path: `{submission_id}/{uuid}-{sanitised-filename}` inside the
// `submission-attachments` bucket. Bucket is private; downloads always
// go through get-attachment-download-url which returns short-lived
// signed URLs.
//
// Validation:
//   * file size 1 byte .. 25 MB (matches DB CHECK + bucket cap)
//   * MIME type allowlist (matches bucket allowed_mime_types)
//   * max 5 files per submission (form context) or per message (inbox)

import { preflight, jsonResponse, corsHeaders } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

// Max bytes — must mirror submission_attachments.size_bytes CHECK and
// storage.buckets.file_size_limit set in migration 020.
const MAX_BYTES = 25 * 1024 * 1024;

// Per-context limits to prevent abuse.
const MAX_FILES_PER_SUBMISSION = 5;  // form context
const MAX_FILES_PER_MESSAGE = 5;     // inbox context

function sanitiseFilename(name: string): string {
  // Keep alphanumerics, dash, underscore, dot, and space — replace
  // everything else with underscore. Collapse runs of underscores.
  const cleaned = name.replace(/[^a-zA-Z0-9._\- ]/g, '_').replace(/_+/g, '_');
  // Cap length at 120 chars (Supabase Storage limit is much higher but
  // we prefer something humans can read).
  return cleaned.slice(0, 120) || 'file';
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'POST required.' }, 405);
    }

    const formData = await req.formData();
    const file = formData.get('file');
    const submissionIdInput = String(formData.get('submission_id') || '').trim();
    const messageIdInput = String(formData.get('message_id') || '').trim() || null;
    const sessionToken = String(formData.get('session_token') || '').trim();

    if (!(file instanceof File)) {
      return jsonResponse({ ok: false, error: 'No file in the upload payload.' }, 400);
    }
    if (!submissionIdInput) {
      return jsonResponse({ ok: false, error: 'submission_id is required.' }, 400);
    }
    if (file.size <= 0) {
      return jsonResponse({ ok: false, error: 'File is empty.' }, 400);
    }
    if (file.size > MAX_BYTES) {
      return jsonResponse({
        ok: false,
        error: `File is too big. Maximum allowed is ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`,
      }, 400);
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return jsonResponse({
        ok: false,
        error: 'That file type isn\'t allowed. Accepted: PDF, PNG, JPG, SVG, DOCX, DOC, XLSX, XLS.',
      }, 400);
    }

    const sb = adminClient();

    // ---- Auth: studio session OR admin JWT
    let uploadedByRole: 'studio' | 'admin' = 'studio';
    let uploadedByAdminId: string | null = null;
    let actor = 'studio';

    if (sessionToken) {
      // Studio path: session_token must match the submission's hash.
      const sessionHash = await sha256Hex(sessionToken);
      const { data: sub } = await sb.from('submissions')
        .select('id, session_expires_at')
        .eq('id', submissionIdInput)
        .eq('session_token_hash', sessionHash)
        .maybeSingle();
      if (!sub) {
        return jsonResponse({ ok: false, error: 'Your session does not match this submission. Please verify your email again.' }, 401);
      }
      if (!sub.session_expires_at || new Date(sub.session_expires_at) < new Date()) {
        return jsonResponse({ ok: false, error: 'Your session has expired. Please verify your email again.' }, 401);
      }
      uploadedByRole = 'studio';
    } else {
      // Admin path: JWT in Authorization header.
      const caller = await getCallerProfile(req);
      if (!caller) {
        return jsonResponse({ ok: false, error: 'Sign-in required to upload files.' }, 401);
      }
      uploadedByRole = 'admin';
      uploadedByAdminId = caller.id;
      actor = `admin:${caller.email}`;
    }

    // ---- Per-context file count enforcement
    if (messageIdInput) {
      const { count } = await sb.from('submission_attachments')
        .select('id', { count: 'exact', head: true })
        .eq('message_id', messageIdInput);
      if ((count ?? 0) >= MAX_FILES_PER_MESSAGE) {
        return jsonResponse({
          ok: false,
          error: `This message already has ${MAX_FILES_PER_MESSAGE} attachments — the maximum allowed.`,
        }, 400);
      }
    } else {
      // Form context — count attachments on this submission that are
      // NOT attached to a message.
      const { count } = await sb.from('submission_attachments')
        .select('id', { count: 'exact', head: true })
        .eq('submission_id', submissionIdInput)
        .is('message_id', null);
      if ((count ?? 0) >= MAX_FILES_PER_SUBMISSION) {
        return jsonResponse({
          ok: false,
          error: `This submission already has ${MAX_FILES_PER_SUBMISSION} attachments — the maximum allowed.`,
        }, 400);
      }
    }

    // ---- Storage path and upload
    // Path scheme keeps related files grouped per submission, and the
    // UUID prefix prevents collisions even if two studios uploaded a file
    // with the same name simultaneously.
    const cleanName = sanitiseFilename(file.name);
    const objectId = crypto.randomUUID();
    const storagePath = `${submissionIdInput}/${objectId}-${cleanName}`;

    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadErr } = await sb.storage
      .from('submission-attachments')
      .upload(storagePath, fileBytes, {
        contentType: file.type,
        upsert: false,
      });
    if (uploadErr) {
      console.error('attachment upload failed:', uploadErr);
      return jsonResponse({
        ok: false,
        error: 'Could not save the file. Please try again — if the issue persists, email info@studiolabsoftware.com.',
      }, 500);
    }

    // ---- Metadata row
    const { data: row, error: rowErr } = await sb.from('submission_attachments')
      .insert({
        submission_id: submissionIdInput,
        message_id: messageIdInput,
        storage_path: storagePath,
        file_name: cleanName,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by_role: uploadedByRole,
        uploaded_by_admin_id: uploadedByAdminId,
      })
      .select('id, submission_id, message_id, file_name, mime_type, size_bytes, uploaded_at, expires_at')
      .single();

    if (rowErr || !row) {
      // Rollback the Storage upload if the metadata row failed — keeps the
      // bucket in sync with the ledger.
      await sb.storage.from('submission-attachments').remove([storagePath]);
      console.error('attachment metadata insert failed:', rowErr);
      return jsonResponse({
        ok: false,
        error: 'Could not record the file. The upload has been rolled back; please try again.',
      }, 500);
    }

    try {
      await sb.from('activity_log').insert({
        submission_id: submissionIdInput,
        action: 'attachment_uploaded',
        actor,
        details: {
          attachment_id: row.id,
          file_name: row.file_name,
          size_bytes: row.size_bytes,
          mime_type: row.mime_type,
          context: messageIdInput ? 'message' : 'form',
          message_id: messageIdInput,
        },
      });
    } catch (e) { console.error('activity_log insert failed:', e); }

    return jsonResponse({ ok: true, attachment: row });
  } catch (err) {
    console.error('upload-submission-attachment error:', err);
    return jsonResponse({
      ok: false,
      error: 'Something went wrong on our end. Please try again, or email info@studiolabsoftware.com.',
    }, 500);
  }
});
