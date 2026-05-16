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
  action: 'load';
  project_id: string;
  token: string;
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
      case 'load': return await actLoad(sb, projectId, auth);
      default:     return jsonResponse({ ok: false, error: 'Unknown action.' }, 400);
    }
  } catch (err) {
    console.error('portal-project error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function actLoad(sb: any, projectId: string, auth: { submissionId?: string | null; externalContactId?: string | null }) {
  const [{ data: project }, { data: invoices }, { data: activity }] = await Promise.all([
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
    // Cosmetic-only flag for the client side. Never trust for authorisation
    // — the server already enforced the project token above.
    _is_studio: !!auth.submissionId,
  });
}
