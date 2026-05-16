// Client-facing project API. Mirrors portal-conversation: single endpoint
// dispatching by `action`, every call gated on a project token. The client
// page never sees admin internal notes or unrelated data.
//
// Actions:
//   load                       — project header + recipient + invoices + activity
//                                + client-visible deliverables (with their
//                                client-visible attachments + comment counts)
//   approve-deliverable        — { deliverable_id }
//   request-revisions          — { deliverable_id, notes }
//   list-deliverable-comments  — { deliverable_id } → comments thread
//   add-deliverable-comment    — { deliverable_id, body } → append client comment

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verifyProjectToken } from '../_shared/projects.ts';
import { sendEmail } from '../_shared/mailgun.ts';
import { deliverableApprovedAdmin, deliverableRevisionsRequestedAdmin } from '../_shared/email-templates.ts';
import { resolveAdminNotificationRecipients } from '../_shared/admin-recipients.ts';

interface RequestBody {
  action:
    | 'load'
    | 'approve-deliverable'
    | 'request-revisions'
    | 'list-deliverable-comments'
    | 'add-deliverable-comment';
  project_id: string;
  token: string;
  // Per-action fields
  deliverable_id?: string;
  notes?: string;
  body?: string;
}

// Activity actions that are safe to surface on the client view. Anything
// project-shaped or invoice-shaped that the recipient already knows about.
// Internal admin-only events (status_changed, owner_changed, note_added,
// invoice_drafted, invoice_voided, etc.) are filtered out server-side.
const CLIENT_VISIBLE_ACTIONS = new Set([
  'project_created',
  'project_completed',
  'invoice_paid',
  'invoice_refunded',
  'invoice_partially_refunded',
  'external_contact_paid',
  'deliverable_submitted_for_review',
  'deliverable_revisions_requested',
  'deliverable_approved',
  'deliverable_delivered',
  'deliverable_file_attached',
  'deliverable_comment_added',
]);

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  try {
    const payload = await req.json() as Partial<RequestBody>;
    const action = payload.action;
    const projectId = (payload.project_id || '').trim();
    const token = (payload.token || '').trim();
    if (!action || !projectId || !token) {
      return jsonResponse({ ok: false, error: 'Missing required fields.' }, 400);
    }

    const sb = adminClient();
    const auth = await verifyProjectToken(sb, projectId, token);
    if (!auth.ok) return jsonResponse({ ok: false, error: 'Invalid or expired link.' }, 401);

    switch (action) {
      case 'load':                       return await actLoad(sb, projectId, auth);
      case 'approve-deliverable':        return await actApproveDeliverable(sb, projectId, payload);
      case 'request-revisions':          return await actRequestRevisions(sb, projectId, payload);
      case 'list-deliverable-comments':  return await actListDeliverableComments(sb, projectId, payload);
      case 'add-deliverable-comment':    return await actAddDeliverableComment(sb, projectId, payload);
      default:                           return jsonResponse({ ok: false, error: 'Unknown action.' }, 400);
    }
  } catch (err) {
    console.error('portal-project error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function actLoad(sb: any, projectId: string, auth: { submissionId?: string | null; externalContactId?: string | null }) {
  const [{ data: project }, { data: invoices }, { data: activity }, { data: deliverables }] = await Promise.all([
    sb.from('projects')
      .select('id, name, project_type, status, currency, due_at, notes, created_at, completed_at, submission_id, external_contact_id, submission:submissions(studio_name, contact_email, first_name, last_name), external_contact:external_contacts(name, email)')
      .eq('id', projectId)
      .maybeSingle(),
    sb.from('invoices')
      .select('id, number, status, total_cents, currency, paid_at, issued_at, hosted_url, marked_paid_manually')
      .eq('project_id', projectId)
      .order('issued_at', { ascending: false }),
    sb.from('activity_log')
      .select('id, action, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(20),
    sb.from('deliverables')
      .select('id, title, description, status, due_date, submitted_at, approved_at, delivered_at, revisions_notes, order_index, created_at')
      .eq('project_id', projectId)
      .eq('visibility', 'client')
      .neq('status', 'cancelled')
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true }),
  ]);

  if (!project) return jsonResponse({ ok: false, error: 'Project not found.' }, 404);

  // Fetch attachments + comment counts scoped to the client-visible
  // deliverables in one round-trip each.
  const deliverableIds = (deliverables || []).map((d: { id: string }) => d.id);
  const attachmentsByDeliverable: Record<string, Array<{ id: string; file_name: string; mime_type: string; size_bytes: number; uploaded_at: string }>> = {};
  const commentCountByDeliverable: Record<string, number> = {};
  if (deliverableIds.length) {
    const [{ data: atts }, { data: comments }] = await Promise.all([
      sb.from('submission_attachments')
        .select('id, deliverable_id, file_name, mime_type, size_bytes, uploaded_at')
        .in('deliverable_id', deliverableIds)
        .order('uploaded_at', { ascending: true }),
      sb.from('deliverable_comments')
        .select('deliverable_id')
        .in('deliverable_id', deliverableIds),
    ]);
    for (const a of (atts || [])) {
      const k = a.deliverable_id as string;
      (attachmentsByDeliverable[k] = attachmentsByDeliverable[k] || []).push({
        id: a.id, file_name: a.file_name, mime_type: a.mime_type, size_bytes: a.size_bytes, uploaded_at: a.uploaded_at,
      });
    }
    for (const c of (comments || [])) {
      const k = c.deliverable_id as string;
      commentCountByDeliverable[k] = (commentCountByDeliverable[k] || 0) + 1;
    }
  }

  const isStudio = !!project.submission_id;
  const recipientName = isStudio
    ? (project.submission?.studio_name
      || [project.submission?.first_name, project.submission?.last_name].filter(Boolean).join(' ')
      || project.submission?.contact_email
      || 'Your studio')
    : (project.external_contact?.name || project.external_contact?.email || 'Project recipient');

  const billedCents = (invoices || [])
    .filter((i: { status: string }) => i.status === 'paid' || i.status === 'partially_refunded')
    .reduce((s: number, i: { total_cents: number | null }) => s + (i.total_cents || 0), 0);

  const visibleActivity = (activity || [])
    .filter((a: { action: string }) => CLIENT_VISIBLE_ACTIONS.has(a.action))
    .map((a: { action: string; created_at: string }) => ({ action: a.action, at: a.created_at }));

  return jsonResponse({
    ok: true,
    project: {
      id: project.id,
      name: project.name,
      project_type: project.project_type,
      status: project.status,
      currency: project.currency,
      due_at: project.due_at,
      created_at: project.created_at,
      completed_at: project.completed_at,
      recipient_name: recipientName,
      recipient_kind: isStudio ? 'studio' : 'external',
    },
    invoices: (invoices || []).map((i: {
      id: string; number: string | null; status: string;
      total_cents: number | null; currency: string;
      paid_at: string | null; issued_at: string | null;
      hosted_url: string | null; marked_paid_manually: boolean | null;
    }) => ({
      id: i.id,
      number: i.number,
      status: i.status,
      total_cents: i.total_cents,
      currency: i.currency,
      paid_at: i.paid_at,
      issued_at: i.issued_at,
      hosted_url: i.hosted_url,
      marked_paid_manually: !!i.marked_paid_manually,
    })),
    billed_cents: billedCents,
    activity: visibleActivity,
    deliverables: (deliverables || []).map((d: {
      id: string; title: string; description: string; status: string;
      due_date: string | null; submitted_at: string | null;
      approved_at: string | null; delivered_at: string | null;
      revisions_notes: string | null; order_index: number; created_at: string;
    }) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      status: d.status,
      due_date: d.due_date,
      submitted_at: d.submitted_at,
      approved_at: d.approved_at,
      delivered_at: d.delivered_at,
      revisions_notes: d.revisions_notes,
      attachments: attachmentsByDeliverable[d.id] || [],
      comment_count: commentCountByDeliverable[d.id] || 0,
    })),
    // Cosmetic-only flag for the client side. Never trust for authorisation
    // — the server already enforced the project token above.
    _is_studio: !!auth.submissionId,
  });
}

// deno-lint-ignore no-explicit-any
async function actApproveDeliverable(sb: any, projectId: string, payload: Partial<RequestBody>) {
  const deliverableId = (payload.deliverable_id || '').trim();
  if (!deliverableId) return jsonResponse({ ok: false, error: 'deliverable_id is required.' }, 400);

  const { data: row } = await sb.from('deliverables')
    .select('id, project_id, status, visibility, title')
    .eq('id', deliverableId)
    .maybeSingle();
  if (!row) return jsonResponse({ ok: false, error: 'Deliverable not found.' }, 404);
  // Defence in depth: confirm the deliverable belongs to the token-verified
  // project and is client-visible.
  if (row.project_id !== projectId) return jsonResponse({ ok: false, error: 'Forbidden.' }, 403);
  if (row.visibility !== 'client') return jsonResponse({ ok: false, error: 'Forbidden.' }, 403);
  if (row.status !== 'submitted_for_review') {
    return jsonResponse({
      ok: false,
      error: `This deliverable is not awaiting your review (status: ${row.status}).`,
    }, 400);
  }

  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb.from('deliverables').update({
    status: 'approved',
    approved_at: nowIso,
  }).eq('id', deliverableId);
  if (upErr) return jsonResponse({ ok: false, error: upErr.message }, 500);

  try {
    await sb.from('activity_log').insert({
      project_id: projectId,
      action: 'deliverable_approved',
      actor: 'client',
      details: { deliverable_id: deliverableId, title: row.title, approved_by: 'client' },
    });
  } catch (_) {}

  try {
    await notifyAdminsOfDeliverableEvent(sb, projectId, row.title, 'approved');
  } catch (e) {
    console.warn('admin deliverable_approved email failed:', e);
  }

  return jsonResponse({ ok: true, approved_at: nowIso });
}

// deno-lint-ignore no-explicit-any
async function actRequestRevisions(sb: any, projectId: string, payload: Partial<RequestBody>) {
  const deliverableId = (payload.deliverable_id || '').trim();
  const notes = (payload.notes || '').trim();
  if (!deliverableId) return jsonResponse({ ok: false, error: 'deliverable_id is required.' }, 400);
  if (!notes) return jsonResponse({ ok: false, error: 'Tell us what needs changing.' }, 400);
  if (notes.length > 2000) return jsonResponse({ ok: false, error: 'Notes are too long.' }, 400);

  const { data: row } = await sb.from('deliverables')
    .select('id, project_id, status, visibility, title')
    .eq('id', deliverableId)
    .maybeSingle();
  if (!row) return jsonResponse({ ok: false, error: 'Deliverable not found.' }, 404);
  if (row.project_id !== projectId) return jsonResponse({ ok: false, error: 'Forbidden.' }, 403);
  if (row.visibility !== 'client') return jsonResponse({ ok: false, error: 'Forbidden.' }, 403);
  if (row.status !== 'submitted_for_review') {
    return jsonResponse({
      ok: false,
      error: `This deliverable is not awaiting your review (status: ${row.status}).`,
    }, 400);
  }

  const { error: upErr } = await sb.from('deliverables').update({
    status: 'revisions_requested',
    revisions_notes: notes.slice(0, 2000),
  }).eq('id', deliverableId);
  if (upErr) return jsonResponse({ ok: false, error: upErr.message }, 500);

  try {
    await sb.from('activity_log').insert({
      project_id: projectId,
      action: 'deliverable_revisions_requested',
      actor: 'client',
      details: { deliverable_id: deliverableId, title: row.title, notes_excerpt: notes.slice(0, 200) },
    });
  } catch (_) {}

  try {
    await notifyAdminsOfDeliverableEvent(sb, projectId, row.title, 'revisions', notes);
  } catch (e) {
    console.warn('admin deliverable_revisions_requested email failed:', e);
  }

  return jsonResponse({ ok: true });
}

// deno-lint-ignore no-explicit-any
async function actListDeliverableComments(sb: any, projectId: string, payload: Partial<RequestBody>) {
  const deliverableId = (payload.deliverable_id || '').trim();
  if (!deliverableId) return jsonResponse({ ok: false, error: 'deliverable_id is required.' }, 400);

  // Confirm the deliverable belongs to this project and is client-visible.
  const { data: deliv } = await sb.from('deliverables')
    .select('id, project_id, visibility')
    .eq('id', deliverableId)
    .maybeSingle();
  if (!deliv || deliv.project_id !== projectId || deliv.visibility !== 'client') {
    return jsonResponse({ ok: false, error: 'Forbidden.' }, 403);
  }

  const { data: rows } = await sb.from('deliverable_comments')
    .select('id, author_kind, author_label, body, created_at')
    .eq('deliverable_id', deliverableId)
    .order('created_at', { ascending: true });

  return jsonResponse({ ok: true, comments: rows || [] });
}

// deno-lint-ignore no-explicit-any
async function actAddDeliverableComment(sb: any, projectId: string, payload: Partial<RequestBody>) {
  const deliverableId = (payload.deliverable_id || '').trim();
  const text = (payload.body || '').trim();
  if (!deliverableId) return jsonResponse({ ok: false, error: 'deliverable_id is required.' }, 400);
  if (!text) return jsonResponse({ ok: false, error: 'Comment cannot be empty.' }, 400);
  if (text.length > 4000) return jsonResponse({ ok: false, error: 'Comment is too long.' }, 400);

  const { data: deliv } = await sb.from('deliverables')
    .select('id, project_id, visibility, title')
    .eq('id', deliverableId)
    .maybeSingle();
  if (!deliv || deliv.project_id !== projectId || deliv.visibility !== 'client') {
    return jsonResponse({ ok: false, error: 'Forbidden.' }, 403);
  }

  // Resolve a friendly author label from the project recipient — snapshot
  // at write time so renames upstream don't rewrite historic comments.
  const { data: project } = await sb.from('projects')
    .select(`
      id, submission_id, external_contact_id,
      submission:submissions(studio_name, contact_email, first_name, last_name),
      external_contact:external_contacts(name, email)
    `)
    .eq('id', projectId)
    .maybeSingle();
  const authorLabel = project?.submission_id
    ? (project.submission?.studio_name
      || [project.submission?.first_name, project.submission?.last_name].filter(Boolean).join(' ')
      || project.submission?.contact_email
      || 'Client')
    : (project?.external_contact?.name || project?.external_contact?.email || 'Client');

  const { data: inserted, error: insErr } = await sb.from('deliverable_comments')
    .insert({
      deliverable_id: deliverableId,
      project_id: projectId,
      author_kind: 'client',
      author_admin_id: null,
      author_label: authorLabel,
      body: text,
    })
    .select('id, author_kind, author_label, body, created_at')
    .single();
  if (insErr || !inserted) {
    return jsonResponse({ ok: false, error: insErr?.message || 'Comment insert failed.' }, 500);
  }

  try {
    await sb.from('activity_log').insert({
      project_id: projectId,
      action: 'deliverable_comment_added',
      actor: 'client',
      details: { deliverable_id: deliverableId, author_kind: 'client', excerpt: text.slice(0, 200) },
    });
  } catch (_) {}

  // Best-effort admin notification. Reuses the existing email notifier in
  // 'comment' mode so admins see comment activity alongside approve /
  // revisions events. Gated on stripe_mode in test like every other email.
  try {
    await notifyAdminsOfDeliverableEvent(sb, projectId, deliv.title, 'comment', text);
  } catch (e) {
    console.warn('admin deliverable_comment_added email failed:', e);
  }

  return jsonResponse({ ok: true, comment: inserted });
}

// deno-lint-ignore no-explicit-any
async function notifyAdminsOfDeliverableEvent(
  sb: any,
  projectId: string,
  deliverableTitle: string,
  kind: 'approved' | 'revisions' | 'comment',
  notes?: string,
) {
  const { data: project } = await sb.from('projects')
    .select(`
      id, name, submission_id, external_contact_id,
      submission:submissions(studio_name, contact_email, first_name, last_name),
      external_contact:external_contacts(name, email)
    `)
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return;

  const recipientName = project.submission_id
    ? (project.submission?.studio_name
      || [project.submission?.first_name, project.submission?.last_name].filter(Boolean).join(' ')
      || project.submission?.contact_email
      || 'Client')
    : (project.external_contact?.name || project.external_contact?.email || 'Client');

  // Mode-aware admin fanout: live -> all active admins, test -> owner-only.
  const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
  const isLive = (settings?.stripe_mode || 'test') === 'live';
  const to = await resolveAdminNotificationRecipients(sb, isLive);
  if (to.length === 0) return;

  const adminOrigin = (Deno.env.get('ADMIN_APP_URL') || 'https://app.studiolabgrowth.com/admin/').replace(/\/$/, '/');
  const adminUrl = `${adminOrigin}#projects/${encodeURIComponent(projectId)}`;

  // Comments piggy-back on the revisions template — same shape (recipient +
  // deliverable + body block). Subject line is rewritten so admins can tell
  // a comment apart from a revisions request at a glance.
  const t = kind === 'approved'
    ? deliverableApprovedAdmin({
        recipientName,
        projectName: project.name,
        deliverableTitle,
        adminUrl,
      })
    : deliverableRevisionsRequestedAdmin({
        recipientName,
        projectName: project.name,
        deliverableTitle,
        notes: notes || '',
        adminUrl,
      });

  const subject = kind === 'comment'
    ? `${recipientName} commented on “${deliverableTitle}”`
    : t.subject;

  const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
  const isLive = (settings?.stripe_mode || 'test') === 'live';
  const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';

  if (isLive) {
    await sendEmail({ to, subject, html: t.html });
  } else if (testRecipient) {
    await sendEmail({
      to: testRecipient,
      subject: `[TEST · admin deliverable ${kind}] ${subject}`,
      html: t.html,
    });
  } else {
    await sendEmail({ to, subject, html: t.html });
  }
}
