// Generates the handoff .docx for a submission and emails it to the
// currently assigned admin user. Caller must be an authenticated owner or
// admin OR be invoked from a trusted server-side context (apply-change-request
// passes the service-role key directly).
//
// On a re-send, fields modified via completed change requests since the prior
// send are flagged as [UPDATED] inside the doc and listed in the email body.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { buildHandoffDoc, handoffFilename } from '../_shared/handoff-doc.ts';
import { handoffEmail } from '../_shared/email-templates.ts';

async function getCallerProfile(req: Request) {
  const authz = req.headers.get('Authorization') || '';
  const token = authz.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) return null;

  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData } = await client.auth.getUser();
  if (!userData?.user?.email) return null;
  const sb = adminClient();
  const { data: row } = await sb.from('admin_users')
    .select('id, email, name, role, is_active')
    .ilike('email', userData.user.email)
    .maybeSingle();
  if (!row || !row.is_active) return null;
  return row;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({}));
    const submissionId = String(body.submission_id || '');
    const skipAuth = body.__internal_skip_auth === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!submissionId) return jsonResponse({ ok: false, error: 'submission_id required.' }, 400);

    // Auth: caller must be owner/admin unless invoked internally with service key.
    let caller: { id: string; name: string; role: string } | null = null;
    if (!skipAuth) {
      caller = await getCallerProfile(req);
      if (!caller) return jsonResponse({ ok: false, error: 'Not authorised.' }, 401);
      if (caller.role !== 'owner' && caller.role !== 'admin') {
        return jsonResponse({ ok: false, error: 'Only owners or admins can send handoffs.' }, 403);
      }
    }

    const sb = adminClient();

    // Load submission
    const { data: sub, error: subErr } = await sb.from('submissions').select('*').eq('id', submissionId).single();
    if (subErr || !sub) return jsonResponse({ ok: false, error: 'Submission not found.' }, 404);

    // Find the active assignment + assignee email/name
    const { data: assignment } = await sb.from('submission_assignments')
      .select('id, admin_user_id, status, last_sent_at')
      .eq('submission_id', submissionId)
      .in('status', ['assigned','in_progress','needs_recheck'])
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!assignment) {
      return jsonResponse({ ok: false, error: 'No active assignment for this submission.' }, 400);
    }

    const { data: assignee } = await sb.from('admin_users')
      .select('id, name, email').eq('id', assignment.admin_user_id).maybeSingle();
    if (!assignee?.email) return jsonResponse({ ok: false, error: 'Assignee has no email.' }, 400);

    // Detect changed fields since last send (using completed change_requests)
    const isRevision = !!assignment.last_sent_at;
    let changedFields: string[] = [];
    if (isRevision) {
      const { data: crs } = await sb.from('change_requests')
        .select('updated_values, completed_at, status')
        .eq('submission_id', submissionId)
        .eq('status', 'completed')
        .gt('completed_at', assignment.last_sent_at);
      const fieldSet = new Set<string>();
      (crs || []).forEach((cr) => {
        const v = cr.updated_values as Record<string, unknown> | null;
        if (v) Object.keys(v).forEach((k) => fieldSet.add(k));
      });
      changedFields = Array.from(fieldSet);
    }

    // Build the doc
    const docBytes = await buildHandoffDoc(sub, {
      assigneeName: assignee.name,
      isRevision,
      changedFields,
      prevSentAt: assignment.last_sent_at,
    });
    const filename = handoffFilename(sub, 1);

    // Email
    const tpl = handoffEmail({
      studioName: sub.studio_name || 'Studio',
      assigneeName: assignee.name,
      isRevision,
      changedFields,
      plan: sub.plan || '',
    });
    await sendEmail({
      to: assignee.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
      attachments: [{
        filename,
        content: docBytes,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }],
    });

    // Stamp last_sent_at and flip to needs_recheck on a revision
    const update: Record<string, unknown> = { last_sent_at: new Date().toISOString() };
    if (isRevision && assignment.status !== 'needs_recheck') update.status = 'needs_recheck';
    await sb.from('submission_assignments').update(update).eq('id', assignment.id);

    await sb.from('activity_log').insert({
      submission_id: submissionId,
      action: 'handoff_sent',
      actor: caller?.name || caller?.id || 'system',
      details: { to: assignee.email, revision: isRevision, changed: changedFields },
    });

    return jsonResponse({ ok: true, sent_to: assignee.email, revision: isRevision, changed: changedFields });
  } catch (err) {
    console.error('send-handoff error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
