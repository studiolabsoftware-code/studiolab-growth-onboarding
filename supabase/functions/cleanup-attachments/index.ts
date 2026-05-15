// Daily cron-driven sweep. Deletes any submission_attachments row whose
// expires_at has passed (per the completion-triggered or 90-day-orphan
// retention policy — see migration 020). Storage object goes first; if
// that fails, the row is marked with `delete_attempted_at` + a reason
// and the next cron run retries.
//
// Auth: service-role only (pg_cron passes the Vault-stored key).
//
// Idempotency: rows already marked `delete_attempted_at` are picked up
// again only if `expires_at` is still in the past. Successful deletes
// remove the row entirely, so each row is processed at most once per
// final outcome.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { isServiceRoleCaller } from '../_shared/caller.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    if (!(await isServiceRoleCaller(req))) {
      return jsonResponse({ ok: false, error: 'Service-role auth required.' }, 401);
    }

    const sb = adminClient();
    const nowIso = new Date().toISOString();

    // Limit per run so a backlog day doesn't push the function past its
    // CPU budget. 200 attachments per day is way more than realistic
    // throughput.
    const { data: expired } = await sb.from('submission_attachments')
      .select('id, submission_id, storage_path, file_name')
      .lt('expires_at', nowIso)
      .order('expires_at', { ascending: true })
      .limit(200);

    const stats = {
      deleted: 0,
      storage_failed: 0,
      row_failed: 0,
      errors: [] as string[],
    };

    for (const row of (expired || [])) {
      try {
        const { error: storageErr } = await sb.storage
          .from('submission-attachments')
          .remove([row.storage_path]);
        if (storageErr) {
          stats.storage_failed++;
          await sb.from('submission_attachments').update({
            delete_attempted_at: nowIso,
            delete_failure_reason: storageErr.message?.slice(0, 200) || 'unknown storage error',
          }).eq('id', row.id);
          stats.errors.push(`storage:${row.id}`);
          continue;
        }
        const { error: rowErr } = await sb.from('submission_attachments')
          .delete()
          .eq('id', row.id);
        if (rowErr) {
          stats.row_failed++;
          stats.errors.push(`row:${row.id}`);
          continue;
        }
        try {
          await sb.from('activity_log').insert({
            submission_id: row.submission_id,
            action: 'attachment_expired',
            actor: 'system',
            details: {
              attachment_id: row.id,
              file_name: row.file_name,
            },
          });
        } catch (e) { console.error('activity_log insert failed:', e); }
        stats.deleted++;
      } catch (e) {
        console.error('cleanup row error', row.id, e);
        stats.errors.push(`exception:${row.id}`);
      }
    }

    return jsonResponse({ ok: true, stats });
  } catch (err) {
    console.error('cleanup-attachments error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
