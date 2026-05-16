// Admin-only deliverable lifecycle endpoint.
//
// Actions:
//   create            — body: { project_id, title, ... } → new deliverable
//   update            — body: { id, title?, description?, ... } → patch
//   submit-for-review — body: { id } → status='submitted_for_review',
//                       submitted_at=now, revisions_notes=null
//   mark-approved     — body: { id } → status='approved', approved_at=now
//   mark-delivered    — body: { id } → status='delivered', delivered_at=now
//   cancel            — body: { id } → status='cancelled', cancelled_at=now
//   delete            — body: { id } → hard delete (admin override)
//
// All actions write to activity_log with project_id set so the project's
// timeline reflects the lifecycle event. Client-side approve / request-
// revisions live on portal-project (token-link auth), not here.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';

type Action =
  | 'create' | 'update'
  | 'submit-for-review' | 'mark-approved' | 'mark-delivered'
  | 'cancel' | 'delete';

interface RequestBody {
  action: Action;
  id?: string;
  project_id?: string;
  title?: string;
  description?: string;
  visibility?: 'client' | 'internal';
  due_date?: string | null;
  assigned_admin_id?: string | null;
  order_index?: number;
  status?: 'pending' | 'in_progress';
}

const VALID_ACTIONS: Action[] = [
  'create', 'update', 'submit-for-review', 'mark-approved', 'mark-delivered', 'cancel', 'delete',
];

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST required.' }, 405);

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Admin sign-in required.' }, 401);

    const body = await req.json().catch(() => ({})) as Partial<RequestBody>;
    const action = body.action as Action;
    if (!VALID_ACTIONS.includes(action)) {
      return jsonResponse({ ok: false, error: `action must be one of: ${VALID_ACTIONS.join(', ')}.` }, 400);
    }

    const sb = adminClient();

    if (action === 'create') return await doCreate(sb, body, caller);

    const id = (body.id || '').trim();
    if (!id) return jsonResponse({ ok: false, error: 'id is required.' }, 400);

    const { data: row } = await sb.from('deliverables')
      .select('id, project_id, status, title, visibility')
      .eq('id', id)
      .maybeSingle();
    if (!row) return jsonResponse({ ok: false, error: 'Deliverable not found.' }, 404);

    switch (action) {
      case 'update':            return await doUpdate(sb, row, body, caller);
      case 'submit-for-review': return await doSubmitForReview(sb, row, caller);
      case 'mark-approved':     return await doMarkApproved(sb, row, caller);
      case 'mark-delivered':    return await doMarkDelivered(sb, row, caller);
      case 'cancel':            return await doCancel(sb, row, caller);
      case 'delete':            return await doDelete(sb, row, caller);
    }
  } catch (err) {
    console.error('manage-deliverable error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function doCreate(sb: any, body: Partial<RequestBody>, caller: any) {
  const projectId = (body.project_id || '').trim();
  const title = (body.title || '').trim();
  if (!projectId) return jsonResponse({ ok: false, error: 'project_id is required.' }, 400);
  if (!title) return jsonResponse({ ok: false, error: 'title is required.' }, 400);

  const { data: project } = await sb.from('projects')
    .select('id, submission_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return jsonResponse({ ok: false, error: 'Project not found.' }, 404);

  const status = body.status === 'pending' ? 'pending' : 'in_progress';
  const visibility = body.visibility === 'internal' ? 'internal' : 'client';
  const orderIndex = Number.isInteger(body.order_index) ? body.order_index : 100;

  const { data: inserted, error: insErr } = await sb.from('deliverables')
    .insert({
      project_id: projectId,
      title: title.slice(0, 200),
      description: (body.description || '').slice(0, 4000),
      status,
      visibility,
      assigned_admin_id: body.assigned_admin_id || null,
      due_date: body.due_date || null,
      order_index: orderIndex,
      created_by: caller.id,
    })
    .select('id, title, status, visibility, project_id')
    .single();
  if (insErr || !inserted) {
    return jsonResponse({ ok: false, error: insErr?.message || 'Deliverable insert failed.' }, 500);
  }

  await logActivity(sb, project, inserted.id, 'deliverable_created', caller, {
    title,
    status,
    visibility,
  });

  return jsonResponse({ ok: true, deliverable: inserted });
}

// deno-lint-ignore no-explicit-any
async function doUpdate(sb: any, row: any, body: Partial<RequestBody>, caller: any) {
  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 200);
  if (typeof body.description === 'string') patch.description = body.description.slice(0, 4000);
  if (body.visibility === 'client' || body.visibility === 'internal') patch.visibility = body.visibility;
  if (body.due_date === null || (typeof body.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date))) {
    patch.due_date = body.due_date || null;
  }
  if (body.assigned_admin_id === null || (typeof body.assigned_admin_id === 'string')) {
    patch.assigned_admin_id = body.assigned_admin_id || null;
  }
  if (Number.isInteger(body.order_index)) patch.order_index = body.order_index;

  if (Object.keys(patch).length === 0) {
    return jsonResponse({ ok: false, error: 'No updatable fields provided.' }, 400);
  }

  const { error: upErr } = await sb.from('deliverables').update(patch).eq('id', row.id);
  if (upErr) return jsonResponse({ ok: false, error: upErr.message }, 500);

  await logActivity(sb, { id: row.project_id, submission_id: null }, row.id, 'deliverable_updated', caller, {
    changed_fields: Object.keys(patch),
  });

  return jsonResponse({ ok: true });
}

// deno-lint-ignore no-explicit-any
async function doSubmitForReview(sb: any, row: any, caller: any) {
  if (row.status === 'submitted_for_review') {
    return jsonResponse({ ok: true, action: 'submit-for-review', skipped: true });
  }
  if (row.status === 'cancelled' || row.status === 'delivered') {
    return jsonResponse({
      ok: false,
      error: `Cannot submit a ${row.status} deliverable.`,
    }, 400);
  }
  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb.from('deliverables').update({
    status: 'submitted_for_review',
    submitted_at: nowIso,
    revisions_notes: null,
  }).eq('id', row.id);
  if (upErr) return jsonResponse({ ok: false, error: upErr.message }, 500);

  await logActivity(sb, { id: row.project_id, submission_id: null }, row.id, 'deliverable_submitted_for_review', caller, {
    title: row.title,
  });

  return jsonResponse({ ok: true, action: 'submit-for-review', submitted_at: nowIso });
}

// deno-lint-ignore no-explicit-any
async function doMarkApproved(sb: any, row: any, caller: any) {
  if (row.status === 'approved' || row.status === 'delivered') {
    return jsonResponse({ ok: true, action: 'mark-approved', skipped: true });
  }
  if (row.status === 'cancelled') {
    return jsonResponse({ ok: false, error: 'Cannot approve a cancelled deliverable.' }, 400);
  }
  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb.from('deliverables').update({
    status: 'approved',
    approved_at: nowIso,
  }).eq('id', row.id);
  if (upErr) return jsonResponse({ ok: false, error: upErr.message }, 500);

  await logActivity(sb, { id: row.project_id, submission_id: null }, row.id, 'deliverable_approved', caller, {
    title: row.title,
    approved_by: 'admin',
  });

  return jsonResponse({ ok: true, action: 'mark-approved', approved_at: nowIso });
}

// deno-lint-ignore no-explicit-any
async function doMarkDelivered(sb: any, row: any, caller: any) {
  if (row.status === 'delivered') {
    return jsonResponse({ ok: true, action: 'mark-delivered', skipped: true });
  }
  if (row.status !== 'approved') {
    return jsonResponse({
      ok: false,
      error: `Only approved deliverables can be marked delivered (current status: ${row.status}).`,
    }, 400);
  }
  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb.from('deliverables').update({
    status: 'delivered',
    delivered_at: nowIso,
  }).eq('id', row.id);
  if (upErr) return jsonResponse({ ok: false, error: upErr.message }, 500);

  await logActivity(sb, { id: row.project_id, submission_id: null }, row.id, 'deliverable_delivered', caller, {
    title: row.title,
  });

  return jsonResponse({ ok: true, action: 'mark-delivered', delivered_at: nowIso });
}

// deno-lint-ignore no-explicit-any
async function doCancel(sb: any, row: any, caller: any) {
  if (row.status === 'cancelled') {
    return jsonResponse({ ok: true, action: 'cancel', skipped: true });
  }
  if (row.status === 'delivered') {
    return jsonResponse({ ok: false, error: 'Cannot cancel a delivered deliverable.' }, 400);
  }
  const nowIso = new Date().toISOString();
  const { error: upErr } = await sb.from('deliverables').update({
    status: 'cancelled',
    cancelled_at: nowIso,
  }).eq('id', row.id);
  if (upErr) return jsonResponse({ ok: false, error: upErr.message }, 500);

  await logActivity(sb, { id: row.project_id, submission_id: null }, row.id, 'deliverable_cancelled', caller, {
    title: row.title,
  });

  return jsonResponse({ ok: true, action: 'cancel', cancelled_at: nowIso });
}

// deno-lint-ignore no-explicit-any
async function doDelete(sb: any, row: any, caller: any) {
  const { error: delErr } = await sb.from('deliverables').delete().eq('id', row.id);
  if (delErr) return jsonResponse({ ok: false, error: delErr.message }, 500);

  try {
    await sb.from('activity_log').insert({
      project_id: row.project_id,
      action: 'deliverable_cancelled',
      actor: caller.email,
      details: { deleted: true, title: row.title },
    });
  } catch (_) {}

  return jsonResponse({ ok: true, action: 'delete' });
}

// deno-lint-ignore no-explicit-any
async function logActivity(sb: any, project: { id: string; submission_id: string | null }, deliverableId: string, action: string, caller: any, details: Record<string, unknown>) {
  try {
    await sb.from('activity_log').insert({
      submission_id: project.submission_id || null,
      project_id: project.id,
      action,
      actor: caller.email,
      details: { ...details, deliverable_id: deliverableId },
    });
  } catch (e) {
    console.warn(`activity_log insert for ${action} failed:`, e);
  }
}
