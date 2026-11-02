// The dashboard server's only door into this backend. Signed per _shared/s2s-auth.ts, so no browser can
// call it, and the public anon key opens nothing. Logic lives in _shared/dashboard-onboarding.ts.
import { adminClient, growthClient, randomToken } from '../_shared/supabase.ts';
import { verifyS2s } from '../_shared/s2s-auth.ts';
import { handleOp, type Port, type Row } from '../_shared/dashboard-onboarding.ts';
import { createGatedSender } from '../_shared/email-gated.ts';
import { resolveAdminNotificationRecipients } from '../_shared/admin-recipients.ts';
import { stallFlagEmail } from '../_shared/email-templates.ts';
import { postSystemMessage } from '../_shared/inbox.ts';

// A constant, not the URL: the gateway rewrites the path, and both ends must sign the same bytes.
const PATH = '/dashboard-onboarding';
const MAX_BODY = 256 * 1024;
const json = (status: number, body: Row) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// deno-lint-ignore no-explicit-any
function port(sb: any, growth: any): Port {
  const must = <T>(r: { data: T; error: unknown }): T => {
    if (r.error) throw r.error;
    return r.data;
  };
  return {
    submissionsByLocation: async (loc) => must(await sb.from('submissions').select('*').eq('location_id', loc).limit(2)),
    signupByLocation: async (loc) => must(await growth.from('inbound_signup').select('location_id, contact_email, contact_first_name, contact_last_name, company_name, plan, region, tier').eq('location_id', loc).maybeSingle()),
    insertSubmission: async (row) => {
      const r = await sb.from('submissions').insert(row).select('*').single();
      if (r.error?.code === '23505') return null;
      if (r.error) throw r.error;
      return r.data;
    },
    updateDraft: async (id, patch) => must(await sb.from('submissions').update(patch).eq('id', id).eq('status', 'draft').select('*').maybeSingle()),
    tasksFor: async (id) => must(await sb.from('setup_tasks').select('surface, status, data, studio_submitted_at, updated_at, waiting_on, waiting_since').eq('submission_id', id)),
    saveTaskIfStudios: async (row) => {
      // Insert first; on an existing tile, update only while its status is still the studio's. One statement each, so no window.
      const ins = await sb.from('setup_tasks').insert(row).select('id');
      if (!ins.error) return true;
      if (ins.error.code !== '23505') throw ins.error;
      const upd: Row[] = must(await sb.from('setup_tasks').update(row).eq('submission_id', row.submission_id).eq('surface', row.surface).in('status', ['pending', 'submitted', 'no_account']).select('id'));
      return upd.length > 0;
    },
    postMessage: (id, name, text) => postSystemMessage(sb, id, name == null ? null : String(name), text),
    log: async (id, action, actor, details) => { must(await sb.from('activity_log').insert({ submission_id: id, action, actor: `dashboard:${actor}`, details })); },
    sweepFacts: async (since) => {
      // Newest first and capped. A studio past the cap is simply not looked at this run, so its flags stay as they are.
      const signups: Row[] = must(await growth.from('inbound_signup').select('location_id, created_at, invited_at').gte('created_at', since).order('created_at', { ascending: false }).limit(200));
      const locations = signups.map((s) => s.location_id as string);
      if (!locations.length) return [];
      const subs: Row[] = must(await sb.from('submissions').select('id, location_id, status, payment_status, created_at, last_saved_at, timezone').in('location_id', locations));
      const tasks: Row[] = subs.length ? must(await sb.from('setup_tasks').select('submission_id, surface, status, updated_at, studio_submitted_at, waiting_on, waiting_since').in('submission_id', subs.map((s) => s.id))) : [];
      const outcomes: Row[] = must(await sb.rpc('invite_outcome_for_locations', { p_locations: locations }));
      return signups.map((s) => {
        const sub = subs.find((x) => x.location_id === s.location_id);
        // Ids, dates and codes only.
        const last = outcomes.find((o) => o.location_id === s.location_id)?.outcome;
        return {
          location_id: s.location_id, signed_up_at: s.created_at, invited_at: s.invited_at ?? null,
          invite_event: last === 'failed_permanent' ? 'bounced' : (last ?? null),
          submission: sub ? {
            status: sub.status, paid: ['paid', 'authorised', 'card_saved'].includes(String(sub.payment_status)), created_at: sub.created_at, last_saved_at: sub.last_saved_at, timezone: sub.timezone ?? null,
            tasks: tasks.filter((t) => t.submission_id === sub.id).map(({ submission_id: _id, ...t }) => t),
          } : null,
        };
      });
    },
    liveFlags: async () => must(await sb.from('setup_stall_flags').select('id, location_id, flag, closed_at, last_emailed_at, emails_sent, done_token').is('cleared_at', null)),
    openFlag: async (location_id, flag, opened_at) => {
      const done_token = randomToken(24);
      const r = await sb.from('setup_stall_flags').insert({ location_id, flag, opened_at, done_token }).select('id').single();
      if (r.error?.code === '23505') return null;
      if (r.error) throw r.error;
      return { id: r.data.id, doneToken: done_token };
    },
    markEmailed: async (id, at, sent) => { must(await sb.from('setup_stall_flags').update({ last_emailed_at: at, emails_sent: sent }).eq('id', id)); },
    clearFlag: async (id, at) => { must(await sb.from('setup_stall_flags').update({ cleared_at: at }).eq('id', id)); },
    // Off until a named go: see handovers in the dashboard repo. Sent only to our own team, never a studio.
    sendFlagEmail: Deno.env.get('STALL_SWEEP_SEND') !== 'on' ? null : async (f) => {
      const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
      const isLive = (settings?.stripe_mode || 'test') === 'live';
      const send = createGatedSender({ isLive, testRecipient: Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '' });
      let to = await resolveAdminNotificationRecipients(sb, isLive);
      if (f.ownerAdminOnly) {
        const { data: chiefs } = await sb.from('admin_users').select('email').in('role', ['owner', 'admin']);
        const allowed = new Set((chiefs ?? []).map((c: Row) => String(c.email).toLowerCase()));
        to = to.filter((e) => allowed.has(e));
      }
      if (!to.length) throw new Error('no recipients');
      const { data: signup } = await growth.from('inbound_signup').select('company_name').eq('location_id', f.locationId).maybeSingle();
      const doneUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/stall-flag-done?done=${encodeURIComponent(f.doneToken)}`;
      const t = stallFlagEmail({ flag: f.flag, studioName: signup?.company_name || f.locationId, doneUrl, reminder: f.reminder });
      await send({ to, subject: t.subject, html: t.html, intent: 'stalled studio flag' });
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { ok: false, code: 'method' });
  try {
    const body = await req.text();
    if (body.length > MAX_BODY) return json(413, { ok: false, code: 'too_large' });
    const sb = adminClient();
    const refusal = await verifyS2s({
      direction: 'dashboard-to-onboarding',
      method: req.method,
      path: PATH,
      body,
      timestamp: req.headers.get('x-s2s-timestamp'),
      nonce: req.headers.get('x-s2s-nonce'),
      signature: req.headers.get('x-s2s-signature'),
      secrets: [Deno.env.get('S2S_DASHBOARD_TO_ONBOARDING'), Deno.env.get('S2S_DASHBOARD_TO_ONBOARDING_PREVIOUS')],
      nowSeconds: Math.floor(Date.now() / 1000),
      claimNonce: async (nonce, expires) => {
        await sb.from('s2s_nonce').delete().lt('expires_at', new Date().toISOString());
        const r = await sb.from('s2s_nonce').insert({ nonce, expires_at: new Date(expires * 1000).toISOString() });
        if (r.error?.code === '23505') return false;
        if (r.error) throw r.error;
        return true;
      },
    });
    if (refusal) {
      console.warn('dashboard-onboarding refused:', refusal);
      // One answer for every refusal: the caller learns nothing about which check failed.
      return json(401, { ok: false, code: 'unauthorised' });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { return json(400, { ok: false, code: 'bad_request' }); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(400, { ok: false, code: 'bad_request' });
    const { status, body: out } = await handleOp(port(sb, growthClient()), parsed as Row);
    return json(status, out);
  } catch (err) {
    // Never the raw error: Postgres messages can carry row values.
    console.error('dashboard-onboarding error:', (err as { code?: string })?.code ?? 'unknown');
    return json(500, { ok: false, code: 'failed' });
  }
});
