// Project-level magic-link helpers. Mirror of _shared/inbox.ts but scoped
// to projects.token (the 64-char hex string minted on spawn). Used by the
// client-facing portal-project edge function and any future endpoints
// (deliverable-event, invite-project-client) that authenticate the client
// side by URL token instead of admin JWT.

// deno-lint-ignore no-explicit-any
type Sb = any;

export interface ProjectTokenResult {
  ok: boolean;
  submissionId?: string | null;
  externalContactId?: string | null;
}

export async function verifyProjectToken(
  sb: Sb,
  projectId: string,
  rawToken: string,
): Promise<ProjectTokenResult> {
  if (!rawToken || !projectId) return { ok: false };
  const { data } = await sb
    .from('projects')
    .select('id, submission_id, external_contact_id, token, token_expires_at, status')
    .eq('id', projectId)
    .maybeSingle();
  if (!data || !data.token) return { ok: false };
  if (!constantTimeEq(data.token, rawToken)) return { ok: false };
  if (data.token_expires_at && new Date(data.token_expires_at).getTime() < Date.now()) {
    return { ok: false };
  }
  // Cancelled projects revoke client access. Phase 6.4 will surface a
  // tailored "project cancelled" page; for now the standard invalid-link
  // view is correct.
  if (data.status === 'cancelled') return { ok: false };
  return {
    ok: true,
    submissionId: data.submission_id || null,
    externalContactId: data.external_contact_id || null,
  };
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Public client-link URL for a project. Used by the admin UI to surface the
// magic link for sharing, and by deliverable-event emails.
//
// IMPORTANT: path is `/project.html` (not `/project/`). GitHub Pages only
// serves /foo/ when /foo/index.html exists, which it doesn't here — the
// clean-folder URL was returning 404 for every recipient. Latent bug
// surfaced during the 2026-05-17 smoke.
export function projectClientUrl(opts: { origin: string; projectId: string; token: string }): string {
  const base = opts.origin.replace(/\/$/, '');
  return `${base}/project.html?p=${encodeURIComponent(opts.projectId)}&t=${encodeURIComponent(opts.token)}`;
}
