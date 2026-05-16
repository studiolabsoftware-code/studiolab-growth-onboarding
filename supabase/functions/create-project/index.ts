// Admin-only project creation endpoint.
//
// Two modes:
//
//   * from_invoice — admin clicks "Create project" on a paid invoice that
//     doesn't have a project yet. Reuses the shared spawnProjectFromInvoice
//     helper with force=true so it ignores the studio opt-in flag (the
//     admin is explicitly asking for a project).
//
//   * standalone — admin creates a project from the Projects screen with
//     no source invoice. Useful for engagements that aren't billed through
//     this system (yet) or that started before invoicing was wired in.
//
// Both modes return the new project's id so the admin UI can navigate
// straight to the project detail page.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { spawnProjectFromInvoice } from '../_shared/post-payment.ts';

interface FromInvoiceBody {
  mode: 'from_invoice';
  invoice_id: string;
  name?: string;
  project_type?: string;
}

interface StandaloneBody {
  mode: 'standalone';
  name: string;
  project_type?: string;
  submission_id?: string;
  external_contact_id?: string;
  currency?: 'AUD' | 'USD';
  due_at?: string;
  notes?: string;
}

type RequestBody = FromInvoiceBody | StandaloneBody;

const PROJECT_TYPES = ['service', 'consulting', 'website_build', 'custom', 'other'];

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST required.' }, 405);

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Admin sign-in required.' }, 401);

    const body = await req.json().catch(() => ({})) as Partial<RequestBody>;
    const mode = body.mode;
    if (mode !== 'from_invoice' && mode !== 'standalone') {
      return jsonResponse({ ok: false, error: "mode must be 'from_invoice' or 'standalone'." }, 400);
    }

    const sb = adminClient();

    if (mode === 'from_invoice') {
      const b = body as Partial<FromInvoiceBody>;
      const invoiceId = (b.invoice_id || '').trim();
      if (!invoiceId) return jsonResponse({ ok: false, error: 'invoice_id is required.' }, 400);
      if (b.project_type && !PROJECT_TYPES.includes(b.project_type)) {
        return jsonResponse({ ok: false, error: `project_type must be one of: ${PROJECT_TYPES.join(', ')}.` }, 400);
      }

      const result = await spawnProjectFromInvoice(sb, invoiceId, {
        force: true,
        actorEmail: caller.email,
        name: b.name,
        projectType: b.project_type,
      });
      if (!result.ok) {
        return jsonResponse({ ok: false, error: result.reason }, 400);
      }
      return jsonResponse({ ok: true, project_id: result.project_id });
    }

    // Standalone create.
    const b = body as Partial<StandaloneBody>;
    const name = (b.name || '').trim();
    if (!name) return jsonResponse({ ok: false, error: 'name is required.' }, 400);
    if (b.project_type && !PROJECT_TYPES.includes(b.project_type)) {
      return jsonResponse({ ok: false, error: `project_type must be one of: ${PROJECT_TYPES.join(', ')}.` }, 400);
    }
    const submissionId = (b.submission_id || '').trim() || null;
    const externalContactId = (b.external_contact_id || '').trim() || null;
    if (!!submissionId === !!externalContactId) {
      return jsonResponse({
        ok: false,
        error: 'Exactly one of submission_id or external_contact_id must be provided.',
      }, 400);
    }
    if (b.currency && b.currency !== 'AUD' && b.currency !== 'USD') {
      return jsonResponse({ ok: false, error: "currency must be 'AUD' or 'USD'." }, 400);
    }

    const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
    const tokenExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString();

    const { data: project, error: projErr } = await sb.from('projects')
      .insert({
        name: name.slice(0, 200),
        project_type: b.project_type || 'service',
        status: 'in_progress',
        submission_id: submissionId,
        external_contact_id: externalContactId,
        currency: b.currency || null,
        due_at: b.due_at || null,
        notes: b.notes || null,
        token,
        token_expires_at: tokenExpires,
        created_by: caller.id,
      })
      .select('id')
      .single();
    if (projErr || !project) {
      return jsonResponse({ ok: false, error: projErr?.message || 'Project insert failed.' }, 500);
    }

    try {
      await sb.from('activity_log').insert({
        submission_id: submissionId,
        project_id: project.id,
        action: 'project_created',
        actor: caller.email,
        details: {
          project_id: project.id,
          project_name: name,
          standalone: true,
        },
      });
    } catch (e) { console.warn('activity_log insert failed:', e); }

    return jsonResponse({ ok: true, project_id: project.id });
  } catch (err) {
    console.error('create-project error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
