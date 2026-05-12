// Anon-invoked from /update.html. Validates a raw token, returns the submission
// snapshot plus the requested fields and admin message. Marks the request as
// 'opened' on first valid lookup.
//
// Body: { token: string }

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const { token } = await req.json();
    if (!token || typeof token !== 'string') {
      return jsonResponse({ valid: false, reason: 'no_token' });
    }

    const sb = adminClient();
    const hash = await sha256Hex(token);
    const { data: cr } = await sb
      .from('change_requests')
      .select('id, submission_id, fields, message, status, token_expires_at')
      .eq('token_hash', hash)
      .single();

    if (!cr) return jsonResponse({ valid: false, reason: 'not_found' });
    if (cr.status === 'completed') return jsonResponse({ valid: false, reason: 'already_used' });
    if (cr.status === 'expired') return jsonResponse({ valid: false, reason: 'expired' });
    if (new Date(cr.token_expires_at).getTime() < Date.now()) {
      await sb.from('change_requests').update({ status: 'expired' }).eq('id', cr.id);
      return jsonResponse({ valid: false, reason: 'expired' });
    }

    const { data: sub } = await sb.from('submissions').select('*').eq('id', cr.submission_id).single();
    if (!sub) return jsonResponse({ valid: false, reason: 'submission_missing' });

    if (cr.status === 'sent') {
      await sb.from('change_requests').update({ status: 'opened' }).eq('id', cr.id);
    }

    return jsonResponse({
      valid: true,
      submission: sub,
      fields: cr.fields,
      message: cr.message,
    });
  } catch (err) {
    console.error('validate-change-request error:', err);
    return jsonResponse({ valid: false, reason: 'error', error: String(err) }, 500);
  }
});
