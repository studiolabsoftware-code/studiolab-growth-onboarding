// Studio Setup Checklist — per-tile save endpoint.
//
// The studio writes their access-delegation info (URLs, IDs) for a single
// tile in the Setup Checklist. Auth is the same session_token used by
// /account.html (get-studio-account, save-draft). Anon-callable
// (deployed --no-verify-jwt) — verification happens via session-token
// hash lookup against submissions.
//
// On submission we:
//   * Validate the surface key against the allowlist
//   * Validate the data shape (per-surface keys)
//   * Update the setup_tasks row (or insert it if somehow missing)
//   * Post a system message into the studio's conversation thread so
//     admins see "Studio submitted GBP access details" in the inbox
//   * Return the updated task row

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { postSystemMessage } from '../_shared/inbox.ts';

type SurfaceKey =
  | 'gbp' | 'ga4' | 'gsc' | 'gtm' | 'google_ads' | 'meta' | 'tiktok'
  | 'sms_a2p' | 'whatsapp';
const VALID_SURFACES = new Set<SurfaceKey>([
  'gbp', 'ga4', 'gsc', 'gtm', 'google_ads', 'meta', 'tiktok',
  'sms_a2p', 'whatsapp',
]);

// Per-surface allowed keys in the `data` jsonb. Any other key in the
// incoming payload is silently dropped to keep the column tidy.
const SURFACE_FIELDS: Record<SurfaceKey, string[]> = {
  gbp:        ['maps_url', 'place_id', 'verification_status', 'notes'],
  ga4:        ['measurement_id', 'property_id', 'account_name', 'notes'],
  gsc:        ['property_url', 'property_type', 'notes'],
  gtm:        ['container_id', 'account_id', 'site_platform', 'notes'],
  google_ads: ['customer_id', 'account_currency', 'account_timezone', 'notes'],
  meta:       ['business_manager_id', 'page_url', 'page_id', 'instagram_username',
               'instagram_is_professional', 'instagram_linked_to_page',
               'ad_account_id', 'pixel_id', 'notes'],
  tiktok:     ['business_center_id', 'ad_account_id', 'handle',
               'handle_is_business', 'notes'],
  sms_a2p:    ['privacy_policy_url', 'terms_url', 'industry_vertical',
               'business_description', 'opt_in_method', 'opt_in_description',
               'opt_in_screenshot_url', 'sample_sms_1', 'sample_sms_2',
               'estimated_monthly_volume', 'sender_id', 'notes'],
  whatsapp:   ['enabled', 'display_name', 'business_category',
               'verification_doc_url', 'notes'],
};

const SURFACE_LABEL: Record<SurfaceKey, string> = {
  gbp:        'Google Business Profile',
  ga4:        'Google Analytics 4',
  gsc:        'Google Search Console',
  gtm:        'Google Tag Manager',
  google_ads: 'Google Ads',
  meta:       'Meta Business Manager',
  tiktok:     'TikTok Business Center',
  sms_a2p:    'SMS compliance & A2P registration',
  whatsapp:   'WhatsApp Business',
};

type StatusKey = 'pending' | 'submitted' | 'no_account';
const VALID_STATUSES = new Set<StatusKey>(['pending', 'submitted', 'no_account']);

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : '';
    const surface = typeof body.surface === 'string' ? body.surface : '';
    const status = typeof body.status === 'string' ? body.status : '';
    const data = (body.data && typeof body.data === 'object') ? body.data as Record<string, unknown> : {};

    if (!sessionToken) return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);
    if (!VALID_SURFACES.has(surface as SurfaceKey)) {
      return jsonResponse({ ok: false, error: 'Unknown surface key.' }, 400);
    }
    if (!VALID_STATUSES.has(status as StatusKey)) {
      return jsonResponse({ ok: false, error: 'Invalid status.' }, 400);
    }

    const sb = adminClient();
    const sessionHash = await sha256Hex(sessionToken);

    const { data: submission } = await sb.from('submissions')
      .select('id, studio_name, payment_status, session_expires_at')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    if (!submission) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!submission.session_expires_at || new Date(submission.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired.' }, 401);
    }
    // Block writes from unpaid studios — the tile UI shouldn't render for
    // them, but the server enforces the same rule independently.
    const PAID_STATUSES = new Set(['paid', 'authorised', 'card_saved']);
    if (!PAID_STATUSES.has(String(submission.payment_status))) {
      return jsonResponse({ ok: false, error: 'Setup checklist is unlocked after payment.' }, 403);
    }

    // Filter the inbound data down to the keys we accept for this surface.
    const allowedKeys = new Set(SURFACE_FIELDS[surface as SurfaceKey]);
    const cleanData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (!allowedKeys.has(k)) continue;
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed) cleanData[k] = trimmed.slice(0, 2000);
      } else if (typeof v === 'boolean' || typeof v === 'number') {
        cleanData[k] = v;
      }
    }

    // Upsert the row. On status='submitted' we stamp studio_submitted_at
    // the first time only — don't keep moving it every resubmit.
    const nowIso = new Date().toISOString();
    const { data: existing } = await sb.from('setup_tasks')
      .select('id, status, studio_submitted_at')
      .eq('submission_id', submission.id)
      .eq('surface', surface)
      .maybeSingle();

    const wasOpenForSubmission = !existing || existing.status === 'pending' || existing.status === 'no_account';
    const studioSubmittedAt = status === 'submitted'
      ? (existing?.studio_submitted_at || nowIso)
      : existing?.studio_submitted_at || null;

    const upsertRow = {
      submission_id: submission.id,
      surface,
      status,
      data: cleanData,
      studio_submitted_at: studioSubmittedAt,
    };

    const { data: saved, error: saveErr } = await sb.from('setup_tasks')
      .upsert(upsertRow, { onConflict: 'submission_id,surface' })
      .select('id, surface, status, data, studio_submitted_at, admin_started_at, completed_at, updated_at')
      .single();
    if (saveErr || !saved) throw saveErr || new Error('Failed to save setup task.');

    // Post a system message in the studio's inbox thread so an admin sees
    // the submission in their workflow. Only do this on a real status
    // transition into submitted/no_account (not on every save).
    if (wasOpenForSubmission && (status === 'submitted' || status === 'no_account')) {
      const label = SURFACE_LABEL[surface as SurfaceKey];
      const text = status === 'submitted'
        ? `Studio submitted ${label} access details. Setup Checklist tile is ready for us to action.`
        : `Studio flagged "I don't have ${label} yet" — they need us to set it up on their behalf.`;
      await postSystemMessage(sb, submission.id, submission.studio_name, text);
    }

    return jsonResponse({ ok: true, task: saved });
  } catch (err) {
    console.error('studio-save-setup-task error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
