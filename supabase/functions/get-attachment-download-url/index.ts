// Returns a short-lived signed URL for downloading a submission attachment.
// The bucket is private — direct Storage URLs return 403, so the only path
// to the file is through this function (or a service-role caller).
//
// Auth: admin JWT OR studio session_token. Studio path requires the
// session to match the attachment's submission_id.
//
// Signed URLs expire in 5 minutes — long enough for the browser to start
// the download, short enough that a leaked URL isn't a long-term liability.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';

const SIGNED_URL_TTL_SECONDS = 5 * 60;

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
      .select('id, submission_id, storage_path, file_name, mime_type')
      .eq('id', attachmentId)
      .maybeSingle();
    if (!row) {
      return jsonResponse({ ok: false, error: 'Attachment not found.' }, 404);
    }

    // ---- Auth: admin OR studio with matching session
    let authorised = false;
    const caller = await getCallerProfile(req);
    if (caller) {
      authorised = true;
    } else if (sessionToken && row.submission_id) {
      const sessionHash = await sha256Hex(sessionToken);
      const { data: sub } = await sb.from('submissions')
        .select('id, session_expires_at')
        .eq('id', row.submission_id)
        .eq('session_token_hash', sessionHash)
        .maybeSingle();
      if (sub && sub.session_expires_at && new Date(sub.session_expires_at) > new Date()) {
        authorised = true;
      }
    }
    if (!authorised) {
      return jsonResponse({ ok: false, error: 'Not authorised to download this file.' }, 401);
    }

    const { data: signed, error: signErr } = await sb.storage
      .from('submission-attachments')
      .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, {
        download: row.file_name,
      });
    if (signErr || !signed?.signedUrl) {
      console.error('signed URL generation failed:', signErr);
      return jsonResponse({
        ok: false,
        error: 'Could not generate the download link. Please try again in a moment.',
      }, 500);
    }

    return jsonResponse({
      ok: true,
      url: signed.signedUrl,
      file_name: row.file_name,
      mime_type: row.mime_type,
      expires_in_seconds: SIGNED_URL_TTL_SECONDS,
    });
  } catch (err) {
    console.error('get-attachment-download-url error:', err);
    return jsonResponse({
      ok: false,
      error: 'Something went wrong on our end. Please try again.',
    }, 500);
  }
});
