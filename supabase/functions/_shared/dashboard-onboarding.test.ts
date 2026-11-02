import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { handleOp, STALL_FLAGS, type Port, type Row } from './dashboard-onboarding.ts';
import { ALLOWED_FIELDS, APP_ANSWER_FIELDS } from './submission-fields.ts';
import { decideInvitedDraft } from './prebind.ts';

const LOC = 'loc_virelia';
const signup = { location_id: LOC, contact_email: 'Owner@Example.com', contact_first_name: 'A', contact_last_name: 'B', company_name: 'Test Studio', plan: 'dominate-ai', region: 'AU', tier: null };

function world(over: Partial<Port> = {}) {
  const subs: Row[] = [];
  const tasks: Row[] = [];
  const flags: Row[] = [];
  const logs: string[] = [];
  const messages: string[] = [];
  const port: Port = {
    submissionsByLocation: (l) => Promise.resolve(subs.filter((s) => s.location_id === l)),
    signupByLocation: (l) => Promise.resolve(l === LOC ? signup : null),
    insertSubmission: (row) => {
      if (subs.some((s) => s.contact_email === row.contact_email)) return Promise.resolve(null);
      const r = { id: `sub${subs.length + 1}`, session_token_hash: 'SECRET', stripe_customer_id: 'cus_X', ...row };
      subs.push(r);
      return Promise.resolve(r);
    },
    updateDraft: (id, patch) => { const r = subs.find((s) => s.id === id)!; if (r.status !== 'draft') return Promise.resolve(null); Object.assign(r, patch); return Promise.resolve(r); },
    tasksFor: (id) => Promise.resolve(tasks.filter((t) => t.submission_id === id)),
    saveTaskIfStudios: (row) => {
      const i = tasks.findIndex((t) => t.submission_id === row.submission_id && t.surface === row.surface);
      if (i >= 0 && (tasks[i].status === 'in_progress' || tasks[i].status === 'complete')) return Promise.resolve(false);
      if (i >= 0) tasks[i] = { ...tasks[i], ...row }; else tasks.push(row);
      return Promise.resolve(true);
    },
    postMessage: (_i, _n, t) => { messages.push(t); return Promise.resolve(); },
    log: (_i, a) => { logs.push(a); return Promise.resolve(); },
    sweepFacts: () => Promise.resolve([{ location_id: LOC }]),
    liveFlags: () => Promise.resolve(flags.filter((f) => !f.cleared_at)),
    openFlag: (location_id, flag) => { const f = { id: `f${flags.length}`, location_id, flag, done_token: 't', emails_sent: 0 }; flags.push(f); return Promise.resolve({ id: f.id, doneToken: 't' }); },
    markEmailed: (id, at, sent) => { Object.assign(flags.find((f) => f.id === id)!, { last_emailed_at: at, emails_sent: sent }); return Promise.resolve(); },
    clearFlag: (id, at) => { flags.find((f) => f.id === id)!.cleared_at = at; return Promise.resolve(); },
    sendFlagEmail: null,
    ...over,
  };
  return { port, subs, tasks, flags, logs, messages };
}
const ensure = (p: Port, location_id = LOC) => handleOp(p, { op: 'setup.ensure', location_id, actor: 'user_1' });

Deno.test('every app question is one a studio may already write', () => {
  for (const f of APP_ANSWER_FIELDS) assert(ALLOWED_FIELDS.has(f), f);
  for (const f of ['setup_type', 'plan', 'consent_captured_at', 'location_id', 'payment_status', 'status']) assert(!(APP_ANSWER_FIELDS as readonly string[]).includes(f), f);
});

Deno.test('ensure creates from the signup, by location; plan and address never come from the caller', async () => {
  const w = world();
  const r = await handleOp(w.port, { op: 'setup.ensure', location_id: LOC, actor: 'user_1', plan: 'launch', contact_email: 'evil@example.com' });
  assertEquals(r.status, 200);
  assertEquals(w.subs[0].plan, 'ai');
  assertEquals(w.subs[0].contact_email, 'owner@example.com');
  assertEquals(w.subs[0].status, 'draft');
  assertEquals(w.logs, ['app_submission_created']);
});

Deno.test('ensure returns the same row on the next call', async () => {
  const w = world();
  await ensure(w.port);
  await ensure(w.port);
  assertEquals(w.subs.length, 1);
});

Deno.test('ensure never adopts a draft by address: that is a conflict', async () => {
  const w = world();
  w.subs.push({ id: 'old', contact_email: 'owner@example.com', plan: 'ai', region: 'AU', location_id: null });
  const r = await ensure(w.port);
  assertEquals([r.status, r.body.code], [409, 'conflict']);
  assertEquals(w.subs.length, 1);
  assertEquals(w.subs[0].location_id, null);
});

Deno.test('no signup, unroutable signup, and two rows on one location are refused', async () => {
  assertEquals((await ensure(world().port, 'loc_other')).body.code, 'no_signup');
  const odd = world({ signupByLocation: () => Promise.resolve({ ...signup, plan: 'mystery' }) });
  assertEquals((await ensure(odd.port)).body.code, 'signup_unroutable');
  const two = world();
  two.subs.push({ id: 'a', location_id: LOC }, { id: 'b', location_id: LOC });
  for (const op of ['setup.read', 'setup.ensure', 'answers.save', 'task.save']) {
    assertEquals((await handleOp(two.port, { op, location_id: LOC, actor: 'u', fields: {} })).body.code, 'conflict', op);
  }
});

Deno.test('a read never creates, and a read of nothing says found false', async () => {
  const w = world();
  const r = await handleOp(w.port, { op: 'setup.read', location_id: LOC, actor: 'u' });
  assertEquals(r.body, { ok: true, found: false });
  assertEquals(w.subs.length, 0);
});

Deno.test('a saved answer survives to the next read, from any device: all state is on the server', async () => {
  const w = world();
  await ensure(w.port);
  await handleOp(w.port, { op: 'answers.save', location_id: LOC, actor: 'u', fields: { studio_description: ' We dance ' } });
  const r = await handleOp(w.port, { op: 'setup.read', location_id: LOC, actor: 'u' });
  assertEquals((r.body.answers as Row).studio_description, 'We dance');
});

Deno.test('what leaves the backend holds no session hash, Stripe id or staff note', async () => {
  const w = world();
  await ensure(w.port);
  const text = JSON.stringify((await handleOp(w.port, { op: 'setup.read', location_id: LOC, actor: 'u' })).body);
  for (const secret of ['SECRET', 'cus_X', 'session_token_hash', 'stripe_customer_id', 'contact_email']) assert(!text.includes(secret), secret);
});

Deno.test('answers: only the list is written; server fields, plan and bad shapes are not', async () => {
  const w = world();
  await ensure(w.port);
  await handleOp(w.port, { op: 'answers.save', location_id: LOC, actor: 'u', fields: { plan: 'launch', status: 'active', payment_status: 'paid', location_id: 'loc_x', setup_type: 'dfy', consent_captured_at: '2000-01-01', website: 'https://x.test' } });
  assertEquals([w.subs[0].plan, w.subs[0].status, w.subs[0].payment_status, w.subs[0].location_id, w.subs[0].setup_type, w.subs[0].consent_captured_at, w.subs[0].website], ['ai', 'draft', undefined, LOC, undefined, undefined, 'https://x.test']);
  assertEquals((await handleOp(w.port, { op: 'answers.save', location_id: LOC, actor: 'u', fields: { website: { a: 1 } } })).body.code, 'bad_request');
});

Deno.test('consent time comes from the server and is kept once given', async () => {
  const w = world();
  await ensure(w.port);
  const t1 = new Date('2026-11-02T00:00:00Z');
  await handleOp(w.port, { op: 'answers.save', location_id: LOC, actor: 'u', fields: { consent_send_on_behalf: true } }, t1);
  await handleOp(w.port, { op: 'answers.save', location_id: LOC, actor: 'u', fields: { consent_send_on_behalf: true } }, new Date('2026-11-03T00:00:00Z'));
  assertEquals(w.subs[0].consent_captured_at, t1.toISOString());
});

Deno.test('a finalised row is never edited', async () => {
  const w = world();
  await ensure(w.port);
  w.subs[0].status = 'submitted';
  assertEquals((await handleOp(w.port, { op: 'answers.save', location_id: LOC, actor: 'u', fields: { website: 'x' } })).body.code, 'not_draft');
});

Deno.test('a tile: refused until paid, posts the same inbox line staff see today, and stays with staff once started', async () => {
  const w = world();
  await ensure(w.port);
  const save = (extra: Row = {}) => handleOp(w.port, { op: 'task.save', location_id: LOC, actor: 'u', surface: 'gbp', status: 'submitted', data: { maps_url: 'https://m', evil: 'x' }, ...extra });
  assertEquals((await save()).body.code, 'unpaid');
  w.subs[0].payment_status = 'paid';
  assertEquals((await save()).status, 200);
  assertEquals(w.tasks[0].data, { maps_url: 'https://m' });
  assertEquals(w.messages, ['Studio submitted Google Business Profile access details. Setup Checklist tile is ready for us to action.']);
  w.tasks[0].status = 'in_progress';
  const r = await handleOp(w.port, { op: 'setup.read', location_id: LOC, actor: 'u' });
  assertEquals((r.body.tasks as Row[]).find((t) => t.surface === 'gbp')!.owner, 'us');
  assertEquals((await save()).body.code, 'staff_owned');
  assertEquals(w.tasks[0].status, 'in_progress');
});

Deno.test('a third-party wait is stamped once by the server; a tile with no wait refuses it', async () => {
  const w = world();
  await ensure(w.port);
  w.subs[0].payment_status = 'paid';
  const t1 = new Date('2026-11-02T00:00:00Z');
  await handleOp(w.port, { op: 'task.save', location_id: LOC, actor: 'u', surface: 'gbp', status: 'no_account', waiting: true, waiting_since: '2000-01-01' }, t1);
  await handleOp(w.port, { op: 'task.save', location_id: LOC, actor: 'u', surface: 'gbp', status: 'no_account', waiting: true }, new Date('2026-11-05T00:00:00Z'));
  assertEquals(w.tasks[0].waiting_since, t1.toISOString());
  assertEquals(w.tasks[0].waiting_on, 'Google');
  assertEquals((await handleOp(w.port, { op: 'task.save', location_id: LOC, actor: 'u', surface: 'ga4', status: 'no_account', waiting: true })).body.code, 'bad_request');
});

Deno.test('bad location, missing actor and unknown op are refused', async () => {
  const w = world();
  for (const body of [{ op: 'setup.read', location_id: "a'; drop" }, { op: 'setup.read', actor: 'u' }, { op: 'setup.read', location_id: LOC }, { op: 'setup.ensure', location_id: LOC }, { op: 'answers.save', location_id: LOC, fields: {} }, { op: 'nope', location_id: LOC, actor: 'u' }, { op: 'sweep.facts', since: 'never' }, { op: 'flags.sync', checked: [LOC], flags: [{ location_id: LOC, flag: 'made_up' }] }, { op: 'flags.sync', checked: [], flags: [{ location_id: null, flag: 'fee_unpaid' }] }, { op: 'flags.sync', flags: [] }, { op: 'flags.sync' }]) {
    assertEquals((await handleOp(w.port, body)).status === 200, false, JSON.stringify(body));
  }
  assertEquals(w.subs.length, 0);
});

Deno.test('flags: with sending off nothing goes out, each flag is recorded once, and clears when its cause does', async () => {
  const w = world();
  const flags = STALL_FLAGS.map((flag) => ({ location_id: LOC, flag }));
  const r = await handleOp(w.port, { op: 'flags.sync', checked: [LOC], flags });
  assertEquals([r.body.opened, r.body.emailed, r.body.unsent], [STALL_FLAGS.length, 0, STALL_FLAGS.length]);
  const again = await handleOp(w.port, { op: 'flags.sync', checked: [LOC], flags });
  assertEquals(again.body.opened, 0);
  assertEquals(w.flags.length, STALL_FLAGS.length);
  assertEquals((await handleOp(w.port, { op: 'flags.sync', checked: [LOC], flags: [] })).body.cleared, STALL_FLAGS.length);
});

Deno.test('flags: with sending on, every flag emails once, money flags to owners and admins only, reminders every three days, and a closed one stays quiet', async () => {
  const sent: Array<{ flag: string; ownerAdminOnly: boolean; reminder: number }> = [];
  const w = world({ sendFlagEmail: (f) => { sent.push(f); return Promise.resolve(); } });
  const flags = STALL_FLAGS.map((flag) => ({ location_id: LOC, flag }));
  const t0 = new Date('2026-11-02T00:00:00Z');
  await handleOp(w.port, { op: 'flags.sync', checked: [LOC], flags }, t0);
  assertEquals(sent.map((s) => s.flag).sort(), [...STALL_FLAGS].sort());
  assertEquals(sent.filter((s) => s.ownerAdminOnly).map((s) => s.flag).sort(), ['fee_oddity', 'plan_payment_refused']);
  await handleOp(w.port, { op: 'flags.sync', checked: [LOC], flags }, new Date('2026-11-03T00:00:00Z'));
  assertEquals(sent.length, STALL_FLAGS.length);
  w.flags[0].closed_at = t0.toISOString();
  const later = await handleOp(w.port, { op: 'flags.sync', checked: [LOC], flags }, new Date('2026-11-06T00:00:00Z'));
  assertEquals(later.body.reminded, STALL_FLAGS.length - 1);
  assertEquals(sent.at(-1)!.reminder, 2);
});

Deno.test('an empty or short sweep clears nothing: a flag clears only for a location it looked at', async () => {
  const w = world();
  await handleOp(w.port, { op: 'flags.sync', checked: [LOC], flags: [{ location_id: LOC, flag: 'fee_unpaid' }] });
  assertEquals((await handleOp(w.port, { op: 'flags.sync', checked: [], flags: [] })).body.cleared, 0);
  assertEquals((await handleOp(w.port, { op: 'flags.sync', checked: ['loc_other'], flags: [] })).body.cleared, 0);
  assertEquals(w.flags[0].cleared_at, undefined);
});

Deno.test('tax numbers go in and never come back; the read says only which are on file', async () => {
  const w = world();
  await ensure(w.port);
  await handleOp(w.port, { op: 'answers.save', location_id: LOC, actor: 'u', fields: { abn: '51 824 753 556' } });
  const r = await handleOp(w.port, { op: 'setup.read', location_id: LOC, actor: 'u' });
  assert(!JSON.stringify(r.body).includes('51 824'));
  assertEquals(r.body.identifiers_on_file, ['abn']);
});

Deno.test('answers: a wrong type for a column is refused, not left to fail in the database', async () => {
  const w = world();
  await ensure(w.port);
  for (const fields of [{ consent_send_on_behalf: 'maybe' }, { custom_domain: 'yes' }, { lead_sources: 'google' }, { website: true }]) {
    assertEquals((await handleOp(w.port, { op: 'answers.save', location_id: LOC, actor: 'u', fields })).body.code, 'bad_request', JSON.stringify(fields));
  }
  await handleOp(w.port, { op: 'answers.save', location_id: LOC, actor: 'u', fields: { lead_sources: ['google'], custom_domain: true }, last_step_completed: -1 });
  assertEquals([w.subs[0].lead_sources, w.subs[0].custom_domain, w.subs[0].last_step_completed], [['google'], true, undefined]);
});

Deno.test('a staff move or a payment landing mid-save wins over the save', async () => {
  const w = world({ saveTaskIfStudios: () => Promise.resolve(false), updateDraft: () => Promise.resolve(null) });
  await ensure(w.port);
  w.subs[0].payment_status = 'paid';
  assertEquals((await handleOp(w.port, { op: 'task.save', location_id: LOC, actor: 'u', surface: 'gbp', status: 'submitted' })).body.code, 'staff_owned');
  assertEquals(w.messages, []);
  assertEquals((await handleOp(w.port, { op: 'answers.save', location_id: LOC, actor: 'u', fields: { website: 'x' } })).body.code, 'not_draft');
});

Deno.test('a data re-save keeps a declared wait; waiting false clears it', async () => {
  const w = world();
  await ensure(w.port);
  w.subs[0].payment_status = 'paid';
  const save = (extra: Row) => handleOp(w.port, { op: 'task.save', location_id: LOC, actor: 'u', surface: 'gbp', status: 'no_account', ...extra });
  await save({ waiting: true });
  w.tasks[0].waiting_on = 'Google';
  await save({});
  assertEquals(w.tasks[0].waiting_on, 'Google');
  await save({ waiting: false });
  assertEquals(w.tasks[0].waiting_on, null);
});

Deno.test('a failed email leaves the flag to retry at the next sweep', async () => {
  let fail = true;
  let sends = 0;
  const w = world({ sendFlagEmail: () => { if (fail) throw new Error('down'); sends++; return Promise.resolve(); } });
  const flags = [{ location_id: LOC, flag: 'fee_unpaid' }];
  const r = await handleOp(w.port, { op: 'flags.sync', checked: [LOC], flags });
  assertEquals(r.body.unsent, 1);
  assertEquals(w.flags[0].last_emailed_at, undefined);
  fail = false;
  await handleOp(w.port, { op: 'flags.sync', checked: [LOC], flags });
  assertEquals(sends, 1);
  assertEquals(w.flags.length, 1);
});

Deno.test('invited path: the location decides, an unbound draft is adopted, a row bound elsewhere refuses', () => {
  const a = { id: 'a', location_id: 'A' };
  assertEquals(decideInvitedDraft('A', a, null), { kind: 'use', row: a });
  assertEquals(decideInvitedDraft('A', null, null), { kind: 'new' });
  const unbound = { id: 'u', location_id: null };
  assertEquals(decideInvitedDraft('A', null, unbound), { kind: 'use', row: unbound });
  assertEquals(decideInvitedDraft('B', null, a), { kind: 'conflict', boundLocationId: 'A' });
});
