// Studio self-edit. Lets a paid studio update safe fields on their own
// submission record from account.html, post-submit. Mirrors save-draft's
// session_token auth but explicitly does NOT lock after submit (that
// guard exists on save-draft to prevent the finalize emails being
// replayed; studio-self-edit can't re-finalize because finalize logic
// lives only in save-draft).
//
// Strict allowlist. Locked fields (plan, setup_type, region,
// contact_email, status, all Stripe billing fields) are intentionally
// excluded; admin handles those server-side.
//
// On every successful edit:
//   1. activity_log row written with actor='studio' and a `changed_fields`
//      array, so admin can audit the diff later.
//   2. Admin team gets an email (test/live gated) with the summary so
//      they know what the studio touched without polling the dashboard.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { resolveAdminNotificationRecipients } from '../_shared/admin-recipients.ts';

// Whitelist of fields the studio can mutate from account.html. Kept tight
// on purpose: anything that affects pricing/auth/identity stays locked.
const ALLOWED_FIELDS = new Set([
  // Identity-adjacent but safe (email is anchor, so it's NOT in here)
  'first_name','last_name','role','contact_phone',
  // Studio info
  'studio_name','legal_name','country','timezone','studio_type',
  'address','website','support_url','studio_description',
  // Branding
  'primary_colour','secondary_colour','sign_off','email_tone','footer_notes',
  // Outbound email config
  'from_name','reply_email','custom_domain','email_domain',
  // Social / handles
  'google_business_url','facebook_url','instagram_handle','booking_url',
  'tiktok_handle','youtube_url',
  // Optional brand reference image URL (already a URL, not an upload)
  'brand_reference_url',
  // Extra notes
  'extra_notes',
]);

function pickAllowed(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    out[k] = v === '' ? null : v;
  }
  return out;
}

function diffFields(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): { changed: string[]; from: Record<string, unknown>; to: Record<string, unknown> } {
  const changed: string[] = [];
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) {
    const a = before[k] ?? null;
    const b = patch[k] ?? null;
    if (a !== b) {
      changed.push(k);
      from[k] = a;
      to[k] = b;
    }
  }
  return { changed, from, to };
}

const FIELD_LABEL: Record<string, string> = {
  first_name: 'First name',
  last_name: 'Last name',
  role: 'Role',
  contact_phone: 'Contact phone',
  studio_name: 'Studio name',
  legal_name: 'Legal entity name',
  country: 'Country',
  timezone: 'Timezone',
  studio_type: 'Studio type',
  address: 'Address',
  website: 'Website',
  support_url: 'Support URL',
  studio_description: 'Studio description',
  primary_colour: 'Primary colour',
  secondary_colour: 'Secondary colour',
  sign_off: 'Email sign-off',
  email_tone: 'Email tone',
  footer_notes: 'Footer notes',
  from_name: 'From name',
  reply_email: 'Reply-to email',
  custom_domain: 'Custom domain',
  email_domain: 'Email domain',
  google_business_url: 'Google Business URL',
  facebook_url: 'Facebook URL',
  instagram_handle: 'Instagram handle',
  booking_url: 'Booking URL',
  tiktok_handle: 'TikTok handle',
  youtube_url: 'YouTube URL',
  brand_reference_url: 'Brand reference URL',
  extra_notes: 'Extra notes',
};

function adminEditEmail(opts: {
  studioName: string;
  contactEmail: string;
  adminUrl: string;
  changed: string[];
  from: Record<string, unknown>;
  to: Record<string, unknown>;
}): { subject: string; html: string } {
  const rows = opts.changed.map((k) => {
    const before = opts.from[k];
    const after = opts.to[k];
    const beforeTxt = before == null || before === '' ? '<em style="color:#9CA3AF">(empty)</em>' : escapeHtml(String(before));
    const afterTxt = after == null || after === '' ? '<em style="color:#9CA3AF">(empty)</em>' : escapeHtml(String(after));
    return `<tr>
      <td style="padding:6px 12px 6px 0;color:#6B7280;font-size:13px;vertical-align:top;">${escapeHtml(FIELD_LABEL[k] || k)}</td>
      <td style="padding:6px 12px;font-size:13px;color:#B91C1C;vertical-align:top;text-decoration:line-through;">${beforeTxt}</td>
      <td style="padding:6px 0;font-size:13px;color:#047857;vertical-align:top;">${afterTxt}</td>
    </tr>`;
  }).join('');
  const subject = `${opts.studioName} updated their submission (${opts.changed.length} field${opts.changed.length === 1 ? '' : 's'})`;
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F3F4F6;padding:24px;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
    <h2 style="margin:0 0 4px;color:#13102E;font-size:20px;">Submission edited by studio</h2>
    <p style="margin:0 0 16px;color:#6B7280;font-size:14px;">${escapeHtml(opts.studioName)} &middot; ${escapeHtml(opts.contactEmail)}</p>
    <table style="border-collapse:collapse;width:100%;margin:0 0 18px;">
      <thead><tr>
        <th style="text-align:left;font-size:11px;text-transform:uppercase;color:#9CA3AF;padding:0 12px 6px 0;border-bottom:1px solid #E5E7EB;">Field</th>
        <th style="text-align:left;font-size:11px;text-transform:uppercase;color:#9CA3AF;padding:0 12px 6px;border-bottom:1px solid #E5E7EB;">Was</th>
        <th style="text-align:left;font-size:11px;text-transform:uppercase;color:#9CA3AF;padding:0 0 6px;border-bottom:1px solid #E5E7EB;">Now</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${opts.adminUrl ? `<a href="${escapeHtml(opts.adminUrl)}" style="display:inline-block;background:#13102E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:13px;">Open in admin</a>` : ''}
  </div>
</body></html>`;
  return { subject, html };
}

function escapeHtml(s: string): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string));
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'POST only' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : '';
    const payload = (body.payload || {}) as Record<string, unknown>;
    if (!sessionToken) return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);

    const sb = adminClient();
    const sessionHash = await sha256Hex(sessionToken);

    const { data: row, error: lookupErr } = await sb.from('submissions')
      .select('*')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    if (lookupErr) throw lookupErr;
    if (!row) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!row.session_expires_at || new Date(row.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired. Please verify your email again.' }, 401);
    }
    // Once admin marks the studio active, the GHL platform is the source
    // of truth — editing here makes no sense and would surprise the studio
    // (they'd assume it propagated). Lock down post-activation.
    if (row.status === 'active') {
      return jsonResponse({
        ok: false,
        error: 'Your account is now active on our platform. Please update your details there from now on.',
        code: 'account_active',
      }, 409);
    }

    const patch = pickAllowed(payload);
    if (Object.keys(patch).length === 0) {
      return jsonResponse({ ok: false, error: 'No editable fields supplied.' }, 400);
    }

    const diff = diffFields(row as Record<string, unknown>, patch);
    if (diff.changed.length === 0) {
      // Nothing actually changed; treat as a no-op success so the UI can
      // flash "Saved" without us hitting downstream side effects.
      return jsonResponse({ ok: true, changed: [], submission: stripServer(row) });
    }

    patch.last_saved_at = new Date().toISOString();

    const { data: saved, error: updErr } = await sb.from('submissions')
      .update(patch)
      .eq('id', row.id)
      .select('*')
      .single();
    if (updErr) throw updErr;

    // Activity log — fire and forget; the edit itself is committed.
    try {
      await sb.from('activity_log').insert({
        submission_id: saved.id,
        action: 'studio_edited_submission',
        actor: row.contact_email || 'studio',
        details: {
          changed_fields: diff.changed,
          from: diff.from,
          to: diff.to,
        },
      });
    } catch (e) { console.error('activity log insert failed:', e); }

    // Admin notification — mode-gated. Test mode restricts to owners.
    try {
      const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
      const isLive = (settings?.stripe_mode || 'test') === 'live';
      const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';
      const sendGated = createGatedSender({ isLive, testRecipient });
      const adminTo = await resolveAdminNotificationRecipients(sb, isLive);
      if (adminTo.length) {
        const appUrl = Deno.env.get('ADMIN_APP_URL') || '';
        const tpl = adminEditEmail({
          studioName: saved.studio_name || '(no name)',
          contactEmail: saved.contact_email || '',
          adminUrl: appUrl ? `${appUrl}?id=${saved.id}` : '',
          changed: diff.changed,
          from: diff.from,
          to: diff.to,
        });
        await sendGated({
          to: adminTo,
          subject: tpl.subject,
          html: tpl.html,
          intent: 'studio self-edit',
        });
      }
    } catch (e) { console.error('admin notification failed:', e); }

    return jsonResponse({ ok: true, changed: diff.changed, submission: stripServer(saved) });
  } catch (err) {
    console.error('studio-self-edit error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});

function stripServer(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  delete out.session_token_hash;
  return out;
}
