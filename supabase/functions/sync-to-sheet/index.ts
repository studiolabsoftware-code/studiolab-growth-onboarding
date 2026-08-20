// One-way mirror of submissions to a Google Sheet via an Apps Script web app.
//
// Two ways this gets called:
//   1) Database webhook on INSERT/UPDATE to submissions (single row).
//      Webhook body shape: { type, table, record, old_record, schema }.
//   2) Manual call from the admin panel for ad-hoc or full re-sync.
//      Body shape: { submission_id?: string, all?: boolean }.
//
// Drafts are intentionally skipped. The sheet is a backup of real submissions,
// not in-progress data. The Apps Script URL and shared secret live in Supabase
// secrets — see docs/sheets-sync-setup.md for the one-time setup.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';

const SHEET_FIELDS = [
  'id','created_at','updated_at','submitted_at','status','assigned_to',
  'plan','setup_type','region',
  'studio_name','legal_name','country','timezone','studio_type','address','website','support_url',
  'first_name','last_name','contact_email','contact_phone','role','studiolab_email',
  'logo_url','primary_colour','secondary_colour','sign_off','email_tone','footer_notes','studio_description',
  'from_name','reply_email','custom_domain','email_domain','dns_access',
  'sms_type','area_code','port_number','sms_tone','lead_sources',
  'extra_notes',
];

async function pushToAppsScript(rows: Record<string, unknown>[]) {
  const url = Deno.env.get('SHEETS_WEBAPP_URL');
  const secret = Deno.env.get('SHEETS_SHARED_SECRET');
  if (!url || !secret) throw new Error('SHEETS_WEBAPP_URL or SHEETS_SHARED_SECRET missing.');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret, rows }),
    redirect: 'follow',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Apps Script ${res.status}: ${text.substring(0, 300)}`);
  try { return JSON.parse(text); } catch { return { ok: true, raw: text }; }
}

function pickFields(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of SHEET_FIELDS) out[f] = row[f] ?? null;
  return out;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({}));
    const sb = adminClient();

    // Resolve which rows to sync.
    let rows: Record<string, unknown>[] = [];
    if (body.all === true) {
      const { data, error } = await sb.from('submissions')
        .select('*')
        .neq('status', 'draft')
        .order('created_at', { ascending: true });
      if (error) throw error;
      rows = data || [];
    } else {
      // Webhook payload: { record } or { record, old_record }. Manual: { submission_id }.
      const record = body.record || null;
      const id = body.submission_id || record?.id;
      if (!id) return jsonResponse({ ok: false, error: 'No submission_id or record.' }, 400);

      // Webhook fires for drafts too — skip them so we do not pollute the sheet.
      if (record && record.status === 'draft') {
        return jsonResponse({ ok: true, skipped: 'draft' });
      }

      const { data, error } = await sb.from('submissions').select('*').eq('id', id).single();
      if (error || !data) throw error || new Error('Submission not found.');
      if (data.status === 'draft') return jsonResponse({ ok: true, skipped: 'draft' });
      rows = [data];
    }

    if (!rows.length) return jsonResponse({ ok: true, synced: 0 });

    // Apps Script expects compact payloads — strip columns we never mirror.
    const payload = rows.map(pickFields);
    const result = await pushToAppsScript(payload);

    // Stamp sync metadata. Best-effort: if this update fails, the sheet is
    // still up-to-date; we just lose the timestamp for this batch.
    const now = new Date().toISOString();
    const ids = rows.map((r) => r.id).filter(Boolean) as string[];
    if (ids.length) {
      await sb.from('submissions')
        .update({ sheets_synced_at: now, sheets_sync_error: null })
        .in('id', ids);
    }

    return jsonResponse({ ok: true, synced: rows.length, appsScript: result });
  } catch (err) {
    console.error('sync-to-sheet error:', err);

    // Try to record the error against the affected row so admins can see it.
    try {
      const bodyClone = await req.clone().json().catch(() => ({}));
      const id = bodyClone.submission_id || bodyClone.record?.id;
      if (id) {
        const sb = adminClient();
        await sb.from('submissions')
          .update({ sheets_sync_error: String(err).substring(0, 500) })
          .eq('id', id);
      }
    } catch { /* swallow secondary failure */ }

    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
