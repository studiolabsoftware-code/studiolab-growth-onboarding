// Auto-save and final submit for the draft submission. Authorised by the
// session_token issued by verify-otp. The same function handles both partial
// saves (status stays 'draft') and final submission (status -> 'submitted').
//
// On final submission, sends the studio confirmation and admin notification
// emails inline rather than relying on a database webhook, so the same flow
// runs whether the row was inserted directly or evolved from a draft.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { submissionConfirmation, adminNewSubmission } from '../_shared/email-templates.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { resolveAdminNotificationRecipients } from '../_shared/admin-recipients.ts';
import { sendIfAllowed } from '../_shared/studio-email.ts';

const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL: Record<string, string> = { dfy: 'Done-For-You', guided: 'Guided' };

// Whitelist of columns the client may write. Server-only fields are excluded.
const ALLOWED_FIELDS = new Set([
  'plan','setup_type','studio_name','legal_name','country','timezone','studio_type',
  'address','website','support_url','first_name','last_name','contact_phone','role',
  'studiolab_email','logo_url','primary_colour','secondary_colour','sign_off',
  'email_tone','footer_notes','studio_description','from_name','reply_email',
  'custom_domain','email_domain','dns_access','sms_type','area_code','port_number',
  'sms_tone','lead_sources',
  // Onboarding form refinement (migration 044). Additive, contract-safe.
  // sms_setup_requested replaces the retired number-preference / Twilio /
  // porting capture; the retired sms_type/area_code/port_number/has_twilio/
  // twilio_number keys stay in the allow-list so older drafts still round-trip,
  // but the current form no longer sends them. Consent trio is the audited
  // send-on-behalf authorisation from the review step.
  'sms_setup_requested',
  'consent_send_on_behalf','consent_captured_at','consent_version',
  'extra_notes',
  // The kb_* and voice_* columns are deliberately NOT writable here. They have
  // exactly one owner, save-kb (plus scrape-and-extract, service-role), and the
  // onboarding form has no inputs for them. While they were allowed, the form
  // sent every one as null on each save, which nulled the scraped knowledge
  // base whenever a Dominate AI studio cancelled at Stripe and returned to the
  // still-'draft' form. The post-submit guard below does not cover that window.
  // Removing them from this allow-list is the backstop; the form no longer
  // sends them either.
  // Optional future-proof URLs for studios planning to upgrade later.
  'google_business_url','facebook_url','instagram_handle','booking_url',
  // Additional social handles collected on Scale and AI lead-sources step.
  'tiktok_handle','youtube_url',
  // Optional brand-colour reference screenshot for hex matching.
  'brand_reference_url',
  // Optional Twilio account connection (Scale and AI).
  'has_twilio', 'twilio_number',
  // Business identity & structured address (migration 040, Phase 1 of the
  // onboarding access & compliance plan). EIN is stored plain text; the admin
  // UI masks it on display. Do not log these fields.
  //
  // ssn_last4 is deliberately NOT writable. We stopped collecting it on
  // 2026-08-20: a US sole proprietor proves identity through the platform's own
  // A2P brand check, a third-party verification they complete in their own
  // sub-account, which we can neither run for them nor feed digits into. The
  // column stays for any historical row; nothing may write it again.
  'legal_business_name','trading_name','business_type',
  'ein','abn','acn',
  'business_email','business_email_is_personal_domain',
  'address_street','address_city','address_region','address_postcode',
]);

function pickAllowed(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (ALLOWED_FIELDS.has(k)) out[k] = v === '' ? null : v;
  }
  return out;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json();
    const { session_token, payload, last_step_completed, finalize } = body;
    if (!session_token || typeof session_token !== 'string') {
      return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);
    }

    const sb = adminClient();
    const sessionHash = await sha256Hex(session_token);

    const { data: row, error: lookupErr } = await sb.from('submissions')
      .select('*')
      .eq('session_token_hash', sessionHash)
      .maybeSingle();

    if (lookupErr) throw lookupErr;
    if (!row) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!row.session_expires_at || new Date(row.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired. Please verify your email again.' }, 401);
    }
    // Post-submit edit guard. The session_token stays valid after payment
    // (so the studio can access account.html, KB, project portal without
    // re-OTP), but save-draft must refuse to mutate a finalised payload.
    // Without this guard, a recovered session_token could be replayed to
    // overwrite the submitted snapshot — or worse, re-fire the finalize
    // emails by passing finalize:true again.
    if (row.status && row.status !== 'draft') {
      return jsonResponse({
        ok: false,
        error: 'This submission is already finalised. Contact support if you need to change something.',
        code: 'already_finalised',
      }, 409);
    }

    const update: Record<string, unknown> = {
      ...pickAllowed(payload || {}),
      last_saved_at: new Date().toISOString(),
    };
    if (typeof last_step_completed === 'number') update.last_step_completed = last_step_completed;

    // Never let the client clear the email or change the verification anchor
    delete (update as Record<string, unknown>).contact_email;

    if (finalize === true) {
      // Send-on-behalf consent is a legal authorisation to email/SMS families
      // on the studio's behalf. The client blocks submit without it, but a
      // direct API call could set finalize:true and skip that gate, so refuse
      // server-side too. Merge the incoming payload value over the stored row.
      const consentGiven = (update.consent_send_on_behalf as boolean | null | undefined)
        ?? (row.consent_send_on_behalf as boolean | null | undefined);
      if (consentGiven !== true) {
        return jsonResponse({
          ok: false,
          error: 'Send-on-behalf consent is required before submitting.',
          code: 'consent_required',
        }, 400);
      }
      update.status = 'submitted';
      update.submitted_at = new Date().toISOString();
      // The session token deliberately stays valid after finalize so the
      // studio can keep using account.html, KB, and the project portal
      // without re-OTP. Edit/replay attacks are blocked by the guard
      // above which 409s any mutation against a non-draft row.
      //
      // (A prior version of this function nulled session_token_hash +
      // session_expires_at here as a belt-and-braces measure -- but
      // that also locked studios out of their own portal until they
      // re-OTP'd, which was reported as a UX bug after hard-refresh
      // post-idle. The 409 guard is sufficient on its own.)
    }

    const { data: saved, error: updErr } = await sb.from('submissions')
      .update(update)
      .eq('id', row.id)
      .select('*')
      .single();
    if (updErr) throw updErr;

    // On finalize, fan out emails + activity log inline (replaces the webhook path)
    if (finalize === true) {
      const ref = String(saved.id).replace(/-/g, '').substring(0, 8).toUpperCase();
      const finalRow = { ...row, ...update };

      // Resolve gating once: test mode redirects through the gate's
      // single test inbox (when STRIPE_TEST_EMAIL_RECIPIENT is set) and
      // restricts admin fanout to owners (so VAs aren't spammed by smoke
      // tests). Live mode delivers to the real recipient list.
      const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
      const isLive = (settings?.stripe_mode || 'test') === 'live';
      const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';
      const sendGated = createGatedSender({ isLive, testRecipient });

      try {
        const t = submissionConfirmation({ studioName: finalRow.studio_name || 'there', ref });
        await sendIfAllowed({
          sb,
          submissionId: saved.id,
          sender: sendGated,
          email: {
            to: row.contact_email,
            subject: t.subject,
            html: t.html,
            replyTo: 'info@studiolabsoftware.com',
            intent: 'studio submission confirmation',
          },
        });
      } catch (e) { console.error('confirmation email failed:', e); }

      try {
        const adminTo = await resolveAdminNotificationRecipients(sb, isLive);
        if (adminTo.length) {
          const appUrl = Deno.env.get('ADMIN_APP_URL') || '';
          const t = adminNewSubmission({
            studioName: finalRow.studio_name || '(no name)',
            plan: PLAN_LABEL[finalRow.plan as string] || (finalRow.plan as string),
            setup: SETUP_LABEL[finalRow.setup_type as string] || (finalRow.setup_type as string),
            adminUrl: `${appUrl}?id=${saved.id}`,
            // Full row drives the copy-friendly digest embedded in the email.
            submission: finalRow as Record<string, unknown>,
          });
          await sendGated({
            to: adminTo,
            subject: t.subject,
            html: t.html,
            intent: 'admin new submission',
          });
        }
      } catch (e) { console.error('admin notification failed:', e); }

      try {
        await sb.from('activity_log').insert({
          submission_id: saved.id,
          action: 'submitted',
          actor: row.contact_email || 'studio',
          details: { plan: finalRow.plan, setup_type: finalRow.setup_type, region: row.region },
        });
      } catch (e) { console.error('activity log insert failed:', e); }

      return jsonResponse({ ok: true, finalized: true, submission_id: saved.id, ref });
    }

    // Strip server-only field before returning
    const { session_token_hash: _h, ...safe } = saved;
    return jsonResponse({ ok: true, finalized: false, last_saved_at: saved.last_saved_at, submission: safe });
  } catch (err) {
    console.error('save-draft error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
