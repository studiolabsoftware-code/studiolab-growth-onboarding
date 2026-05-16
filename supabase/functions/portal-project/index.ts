// Client-facing project API. Mirrors portal-conversation: single endpoint
// dispatching by `action`, every call gated on a project token. The client
// page never sees admin internal notes or unrelated data.
//
// Actions:
//   load — returns project header + recipient summary + linked invoices +
//          client-visible activity events.
//
// Phase 6.3 will add deliverable actions (load deliverables, approve,
// request revisions). Phase 6.4 will add file-attachment download URLs
// and message-send hooks for project-scoped conversations.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verifyProjectToken } from '../_shared/projects.ts';

interface RequestBody {
  action: 'load' | 'approve-deliverable' | 'request-revisions';
  project_id: string;
  token: string;
  // Per-action fields
  deliverable_id?: string;     // approve / request-revisions
  notes?: string;              // request-revisions
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
      case 'load':                return await actLoad(sb, projectId, auth);
      case 'approve-deliverable': return await actApproveDeliverable(sb, projectId, payload);
      case 'request-revisions':   return await actRequestRevisions(sb, projectId, payload);
      default:                    return jsonResponse({ ok: false, error: 'Unknown action.' }, 400);
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

  return jsonResponse({ ok: true });
}
