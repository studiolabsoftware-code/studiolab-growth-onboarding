// Auto-save and final submit for the draft submission. Authorised by the
// session_token issued by verify-otp. The same function handles both partial
// saves (status stays 'draft') and final submission (status -> 'submitted').
//
// On final submission, sends the studio confirmation and admin notification
// emails inline rather than relying on a database webhook, so the same flow
// runs whether the row was inserted directly or evolved from a draft.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, growthClient, sha256Hex } from '../_shared/supabase.ts';
import { resolvePrebind, buildSeed, type PrebindRow } from '../_shared/prebind.ts';
import { submissionConfirmation, adminNewSubmission } from '../_shared/email-templates.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { resolveAdminNotificationRecipients } from '../_shared/admin-recipients.ts';
import { sendIfAllowed } from '../_shared/studio-email.ts';
import { pickAllowed } from '../_shared/submission-fields.ts';

const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL: Record<string, string> = { dfy: 'Done-For-You', guided: 'Guided' };

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json();
    const { session_token, payload, last_step_completed, finalize, t: prebindToken } = body;
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

    // PRE-BIND SEED FOR AN ALREADY-SIGNED-IN STUDIO.
    //
    // The OTP path is not the only way a studio arrives from an invite link. Anyone who has already
    // started the form carries a 90-day session, so clicking their invite hydrates the draft and
    // returns WITHOUT ever going near send-otp / verify-otp - and without this, location_id would
    // never be stamped for exactly those studios. That is the case that produced this whole slice:
    // the first person to test it had already been through the flow once.
    //
    // No new authority: the session token has already authenticated this row, and the token only
    // ever adds values to fields the studio has left empty (buildSeed's no-clobber rule).
    let prebindSeed: Record<string, string> = {};
    let prebindConflict = false;
    if (prebindToken !== undefined && prebindToken !== null && prebindToken !== '') {
      const prebound = await resolvePrebind(prebindToken, async (rawToken) => {
        const { data, error } = await growthClient()
          .rpc('resolve_signup_by_token', { p_raw_token: rawToken });
        if (error) {
          console.error('prebind rpc failed:', error.code ?? 'no-code', error.message ?? 'no-message');
          throw error;
        }
        return data as PrebindRow[] | null;
      });
      if (prebound) {
        if (row.location_id && row.location_id !== prebound.locationId) {
          prebindConflict = true;
          console.error('prebind: session draft already bound to a different sub-account', {
            submission_id: row.id,
            bound_location_id: row.location_id,
            token_location_id: prebound.locationId,
          });
        } else {
          prebindSeed = buildSeed(prebound, row);
        }
      }
    }

    const update: Record<string, unknown> = {
      ...pickAllowed(payload || {}),
      ...prebindSeed,
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

      return jsonResponse({ ok: true,
      ...(prebindConflict ? { location_conflict: true } : {}), finalized: true, submission_id: saved.id, ref });
    }

    // Strip server-only field before returning
    const { session_token_hash: _h, ...safe } = saved;
    return jsonResponse({ ok: true, finalized: false, last_saved_at: saved.last_saved_at, submission: safe });
  } catch (err) {
    console.error('save-draft error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
