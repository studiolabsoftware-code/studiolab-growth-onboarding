// Uploads a single file to the submission-attachments bucket and records
// the metadata row. Four auth paths:
//
//   1. Studio session_token (FORM context) — passed in form data as
//      `session_token`. Matched against submissions.session_token_hash;
//      the resolved submission must match the submission_id in the body.
//      Used by the onboarding form (message_id IS NULL).
//
//   2. Studio conversation token (INBOX context) — passed in form data as
//      `conversation_id` + `token`. Matched against
//      conversations.studio_token; the submission_id is derived from
//      the conversation, and `message_id` is required. Used by the
//      studio portal composer where the studio is authenticated by the
//      magic-link token rather than a submission session.
//
//   3. Admin Authorization JWT (submission scope) — verified via
//      getCallerProfile. submission_id comes from the form body; admin can
//      upload against any submission. uploaded_by_role='admin'.
//
//   4. Admin Authorization JWT (deliverable scope) — admin uploads a file
//      against a specific deliverable on a project. deliverable_id is
//      required; submission_id is derived from projects.submission_id (or
//      null for external-contact projects). uploaded_by_role='admin'.
//      Storage path uses the deliverable's parent project id when there's
//      no submission.
//
// Storage path:
//   * submission scope:  `{submission_id}/{uuid}-{sanitised-filename}`
//   * deliverable scope (studio): `{submission_id}/{uuid}-{name}` (so it
//     still falls under the submission-status retention trigger)
//   * deliverable scope (external): `projects/{project_id}/{uuid}-{name}`
//
// Bucket is private; downloads always go through get-attachment-download-url
// which returns short-lived signed URLs.
//
// Validation:
//   * file size 1 byte .. 25 MB (matches DB CHECK + bucket cap)
//   * MIME type allowlist (matches bucket allowed_mime_types)
//   * max 5 files per submission (form context), per message (inbox), or
//     per deliverable (admin/deliverable context)

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
const MAX_FILES_PER_DELIVERABLE = 10; // admin/deliverable context — higher
                                      // than form/inbox because deliverables
                                      // often bundle multiple drafts/exports.

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
    let submissionIdInput = String(formData.get('submission_id') || '').trim();
    const messageIdInput = String(formData.get('message_id') || '').trim() || null;
    const deliverableIdInput = String(formData.get('deliverable_id') || '').trim() || null;
    const sessionToken = String(formData.get('session_token') || '').trim();
    const conversationIdInput = String(formData.get('conversation_id') || '').trim();
    const conversationToken = String(formData.get('token') || '').trim();

    // Resolved per-upload context. deliverable-scope writes also use this
    // to remember the parent project for the storage path + activity_log.
    let deliverableProjectId: string | null = null;

    if (!(file instanceof File)) {
      return jsonResponse({ ok: false, error: 'No file in the upload payload.' }, 400);
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

    // ---- Auth: studio session_token OR studio conversation-token OR admin JWT
    let uploadedByRole: 'studio' | 'admin' = 'studio';
    let uploadedByAdminId: string | null = null;
    let actor = 'studio';

    if (sessionToken) {
      // Studio FORM path: session_token must match the submission's hash.
      if (!submissionIdInput) {
        return jsonResponse({ ok: false, error: 'submission_id is required.' }, 400);
      }
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
    } else if (conversationIdInput && conversationToken) {
      // Studio INBOX path: conversation token authenticates the magic-link
      // recipient. message_id is required so the file is tied to a message;
      // the submission_id is derived from the conversation rather than
      // trusting the form body.
      if (!messageIdInput) {
        return jsonResponse({ ok: false, error: 'message_id is required for inbox uploads.' }, 400);
      }
      const { data: conv } = await sb.from('conversations')
        .select('id, submission_id, studio_token')
        .eq('id', conversationIdInput)
        .maybeSingle();
      if (!conv || !conv.studio_token || conv.studio_token !== conversationToken) {
        return jsonResponse({ ok: false, error: 'Invalid or revoked link.' }, 401);
      }
      // Verify the message belongs to this conversation and was sent by
      // the studio side — admins can attach via the admin JWT path.
      const { data: msg } = await sb.from('messages')
        .select('id, conversation_id, sender_role')
        .eq('id', messageIdInput)
        .eq('conversation_id', conversationIdInput)
        .maybeSingle();
      if (!msg) {
        return jsonResponse({ ok: false, error: 'Message not found in this conversation.' }, 404);
      }
      if (msg.sender_role !== 'studio') {
        return jsonResponse({ ok: false, error: 'You can only attach files to your own messages.' }, 403);
      }
      submissionIdInput = conv.submission_id;
      uploadedByRole = 'studio';
      actor = `studio:conv:${conversationIdInput}`;
    } else {
      // Admin path: JWT in Authorization header. Two sub-cases:
      //   * deliverable scope: deliverable_id supplied; submission_id is
      //     derived from the deliverable's project (may be null for an
      //     external-contact project).
      //   * submission scope: submission_id supplied; legacy behaviour.
      const caller = await getCallerProfile(req);
      if (!caller) {
        return jsonResponse({ ok: false, error: 'Sign-in required to upload files.' }, 401);
      }
      if (deliverableIdInput) {
        const { data: deliv } = await sb.from('deliverables')
          .select('id, project_id, projects:project_id(id, submission_id, external_contact_id)')
          .eq('id', deliverableIdInput)
          .maybeSingle();
        if (!deliv) {
          return jsonResponse({ ok: false, error: 'Deliverable not found.' }, 404);
        }
        // The generated client types this embed as an ARRAY, while the runtime returns a single
        // object for a to-one relation. The previous line asserted the object shape straight over the
        // array type, which TS refuses because the two do not overlap - which is why this function has
        // never type-checked. Normalising is better than casting harder: it takes the first element if
        // an array really does arrive and the value itself otherwise, so it is right either way rather
        // than right until the client changes its mind.
        const rawProj = (deliv as unknown as { projects?: unknown }).projects;
        const proj = (Array.isArray(rawProj) ? rawProj[0] : rawProj) as
          | { id: string; submission_id: string | null; external_contact_id: string | null }
          | null
          | undefined;
        if (!proj) {
          return jsonResponse({ ok: false, error: 'Deliverable has no parent project.' }, 400);
        }
        deliverableProjectId = proj.id;
        submissionIdInput = proj.submission_id || '';
        if (!submissionIdInput && !proj.external_contact_id) {
          return jsonResponse({ ok: false, error: 'Deliverable project has no recipient.' }, 400);
        }
      } else if (!submissionIdInput) {
        return jsonResponse({ ok: false, error: 'submission_id or deliverable_id is required.' }, 400);
      }
      uploadedByRole = 'admin';
      uploadedByAdminId = caller.id;
      actor = `admin:${caller.email}`;
    }

    // ---- Per-context file count enforcement
    if (deliverableIdInput) {
      const { count } = await sb.from('submission_attachments')
        .select('id', { count: 'exact', head: true })
        .eq('deliverable_id', deliverableIdInput);
      if ((count ?? 0) >= MAX_FILES_PER_DELIVERABLE) {
        return jsonResponse({
          ok: false,
          error: `This deliverable already has ${MAX_FILES_PER_DELIVERABLE} files — the maximum allowed.`,
        }, 400);
      }
    } else if (messageIdInput) {
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
      // NOT attached to a message or deliverable.
      const { count } = await sb.from('submission_attachments')
        .select('id', { count: 'exact', head: true })
        .eq('submission_id', submissionIdInput)
        .is('message_id', null)
        .is('deliverable_id', null);
      if ((count ?? 0) >= MAX_FILES_PER_SUBMISSION) {
        return jsonResponse({
          ok: false,
          error: `This submission already has ${MAX_FILES_PER_SUBMISSION} attachments — the maximum allowed.`,
        }, 400);
      }
    }

    // ---- Storage path and upload
    // Path scheme keeps related files grouped, with a UUID prefix to prevent
    // collisions. Deliverables on external-contact projects can't use a
    // submission_id (there isn't one), so they live under projects/<id>/.
    const cleanName = sanitiseFilename(file.name);
    const objectId = crypto.randomUUID();
    const storagePath = submissionIdInput
      ? `${submissionIdInput}/${objectId}-${cleanName}`
      : `projects/${deliverableProjectId}/${objectId}-${cleanName}`;

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
        submission_id: submissionIdInput || null,
        message_id: messageIdInput,
        deliverable_id: deliverableIdInput,
        storage_path: storagePath,
        file_name: cleanName,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by_role: uploadedByRole,
        uploaded_by_admin_id: uploadedByAdminId,
      })
      .select('id, submission_id, message_id, deliverable_id, file_name, mime_type, size_bytes, uploaded_at, expires_at')
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
      const isDeliverableScope = !!deliverableIdInput;
      await sb.from('activity_log').insert({
        submission_id: submissionIdInput || null,
        project_id: isDeliverableScope ? deliverableProjectId : null,
        action: isDeliverableScope ? 'deliverable_file_attached' : 'attachment_uploaded',
        actor,
        details: {
          attachment_id: row.id,
          file_name: row.file_name,
          size_bytes: row.size_bytes,
          mime_type: row.mime_type,
          context: isDeliverableScope ? 'deliverable' : (messageIdInput ? 'message' : 'form'),
          message_id: messageIdInput,
          deliverable_id: deliverableIdInput,
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
