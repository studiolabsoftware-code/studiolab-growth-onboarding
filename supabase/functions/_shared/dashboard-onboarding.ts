// What the dashboard server may ask of this backend, once its signature has passed. The location always
// comes from the signed body, which the dashboard takes from its verified session, never the browser.
// A submission is found or created by location ONLY, never by email. Responses carry codes, never reasons.
//
// PURE + INJECTED. The database and email are a port, so every branch runs under `deno test`.
import { mapPlan, mapRegion, type PrebindRow } from './prebind.ts';
import { identifiersFor } from './business-identifiers.ts';
import { visibleSurfaces } from './setup-surfaces.ts';
import { APP_ANSWER_FIELDS, pickAllowed } from './submission-fields.ts';
import { cleanTaskData, taskMessage, taskOwner, THIRD_PARTY_WAITS, VALID_STATUSES, VALID_SURFACES, type SurfaceKey } from './setup-task-rules.ts';

export type Row = Record<string, unknown>;
export const PAID_STATUSES = new Set(['paid', 'authorised', 'card_saved']);
const LOCATION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ACTOR_RE = /^[A-Za-z0-9_:-]{1,128}$/;
const MAX_TEXT = 4000;
const REMIND_EVERY_DAYS = 3;
/** Tax numbers go in and never come back out. The read says only which are on file. */
const WRITE_ONLY = new Set<string>(['ein', 'abn', 'acn', 'nzbn', 'crn', 'bn', 'tax_id']);
const BOOLEAN_ANSWERS = new Set<string>(['custom_domain', 'business_email_is_personal_domain', 'sms_setup_requested', 'consent_send_on_behalf']);
const LIST_ANSWERS = new Set<string>(['lead_sources']);

export const STALL_FLAGS = [
  'account_no_install', 'owner_unconfirmed', 'never_opened', 'fee_unpaid', 'studio_step_idle',
  'our_step_idle', 'third_party_overrun', 'fee_oddity', 'plan_payment_refused',
] as const;
export type StallFlag = typeof STALL_FLAGS[number];
/** Money flags go to owners and admins, not the whole team (plan section 5). */
const OWNER_ADMIN_ONLY = new Set<string>(['fee_oddity', 'plan_payment_refused']);

export interface Port {
  submissionsByLocation(locationId: string): Promise<Row[]>;
  signupByLocation(locationId: string): Promise<PrebindRow | null>;
  /** Null when the row would break a unique rule: this location raced, or the address already has a draft. */
  insertSubmission(row: Row): Promise<Row | null>;
  /** Writes only while the row is still a draft. Null when it no longer is. */
  updateDraft(id: string, patch: Row): Promise<Row | null>;
  tasksFor(submissionId: string): Promise<Row[]>;
  /** Writes only while the tile is still the studio's. False when staff have it, however recently they took it. */
  saveTaskIfStudios(row: Row): Promise<boolean>;
  postMessage(submissionId: string, studioName: unknown, text: string): Promise<void>;
  log(submissionId: string, action: string, actor: string, details: Row): Promise<void>;
  sweepFacts(since: string): Promise<Row[]>;
  liveFlags(): Promise<Row[]>;
  /** Null if another sweep got there first. */
  openFlag(locationId: string, flag: string, nowIso: string): Promise<{ id: string; doneToken: string } | null>;
  markEmailed(id: string, nowIso: string, sent: number): Promise<void>;
  clearFlag(id: string, nowIso: string): Promise<void>;
  /** Null when sending is off. Sending is off until the send gate is opened by a named go. */
  sendFlagEmail: null | ((f: { locationId: string; flag: string; doneToken: string; ownerAdminOnly: boolean; reminder: number }) => Promise<void>);
}

export type Result = { status: number; body: Row };
const isLocation = (v: unknown): v is string => typeof v === 'string' && LOCATION_RE.test(v);
const refuse = (status: number, code: string): Result => ({ status, body: { ok: false, code } });

/** Only these leave the backend. No session hash, Stripe id, pricing, or staff note can be added by a new column. */
function safeSubmission(s: Row): Row {
  const out: Row = {};
  for (const k of APP_ANSWER_FIELDS) if (!WRITE_ONLY.has(k)) out[k] = s[k] ?? null;
  return out;
}

function safeTask(t: Row): Row {
  const surface = String(t.surface);
  const wait = THIRD_PARTY_WAITS[surface as SurfaceKey];
  return {
    surface,
    status: t.status ?? 'pending',
    owner: taskOwner(t.status as string),
    data: t.data ?? {},
    updated_at: t.updated_at ?? null,
    waiting_on: t.waiting_on ?? null,
    waiting_since: t.waiting_since ?? null,
    can_wait_on: wait?.who ?? null,
    wait_max_days: wait?.maxDays ?? null,
  };
}

async function view(p: Port, s: Row): Promise<Result> {
  const rows = await p.tasksFor(String(s.id));
  const byId = new Map(rows.map((t) => [String(t.surface), t]));
  const { surfaces, messagingPending } = visibleSurfaces(s.plan as string, (x) => byId.get(x)?.status as string | undefined);
  return {
    status: 200,
    body: {
      ok: true,
      found: true,
      plan: s.plan ?? null,
      region: s.region ?? null,
      submission_status: s.status ?? null,
      last_saved_at: s.last_saved_at ?? null,
      answers: safeSubmission(s),
      identifiers_on_file: [...WRITE_ONLY].filter((k) => s[k]),
      identifier_fields: identifiersFor(s.country as string, s.business_type as string).map((i) => i.key),
      checklist_open: PAID_STATUSES.has(String(s.payment_status)),
      messaging_pending: messagingPending,
      tasks: surfaces.map((surface) => safeTask(byId.get(surface) ?? { surface })),
    },
  };
}

async function oneByLocation(p: Port, locationId: string): Promise<{ row: Row | null; conflict: boolean }> {
  const rows = await p.submissionsByLocation(locationId);
  return { row: rows[0] ?? null, conflict: rows.length > 1 };
}

function cleanAnswers(fields: unknown): Row | null {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const allowed = new Set<string>(APP_ANSWER_FIELDS);
  const picked = pickAllowed(Object.fromEntries(Object.entries(fields as Row).filter(([k]) => allowed.has(k))));
  const out: Row = {};
  for (const [k, v] of Object.entries(picked)) {
    if (v === null) out[k] = null;
    else if (BOOLEAN_ANSWERS.has(k)) {
      if (typeof v !== 'boolean') return null;
      out[k] = v;
    } else if (LIST_ANSWERS.has(k)) {
      if (!Array.isArray(v) || v.length > 50 || !v.every((x) => typeof x === 'string')) return null;
      out[k] = v.map((x) => x.slice(0, 200));
    } else {
      if (typeof v !== 'string') return null;
      out[k] = v.trim().slice(0, MAX_TEXT) || null;
    }
  }
  return out;
}

export async function handleOp(p: Port, body: Row, now = new Date()): Promise<Result> {
  const op = body.op;
  const nowIso = now.toISOString();

  if (op === 'sweep.facts') {
    const since = typeof body.since === 'string' && !Number.isNaN(Date.parse(body.since)) ? new Date(body.since).toISOString() : null;
    if (!since) return refuse(400, 'bad_request');
    return { status: 200, body: { ok: true, studios: await p.sweepFacts(since) } };
  }

  if (op === 'flags.sync') {
    if (!Array.isArray(body.flags) || body.flags.length > 2000 || !Array.isArray(body.checked) || body.checked.length > 2000) return refuse(400, 'bad_request');
    if (!body.checked.every((l) => isLocation(l))) return refuse(400, 'bad_request');
    // A flag clears only for a location this sweep actually looked at, so a short or failed read clears nothing.
    const checked = new Set<string>(body.checked as string[]);
    const firing = new Set<string>();
    for (const f of body.flags as Row[]) {
      if (!isLocation(f?.location_id) || !(STALL_FLAGS as readonly string[]).includes(String(f?.flag))) return refuse(400, 'bad_request');
      firing.add(`${f.location_id}|${f.flag}`);
    }
    const counts = { opened: 0, reminded: 0, cleared: 0, emailed: 0, unsent: 0 };
    const live = await p.liveFlags();
    const seen = new Set<string>();
    const email = async (f: { locationId: string; flag: string; doneToken: string; reminder: number }) => {
      if (!p.sendFlagEmail) { counts.unsent++; return false; }
      try {
        await p.sendFlagEmail({ ...f, ownerAdminOnly: OWNER_ADMIN_ONLY.has(f.flag) });
        counts.emailed++;
        return true;
      } catch {
        counts.unsent++;
        return false;
      }
    };
    for (const row of live) {
      const key = `${row.location_id}|${row.flag}`;
      seen.add(key);
      if (!firing.has(key)) {
        if (!checked.has(String(row.location_id))) continue;
        await p.clearFlag(String(row.id), nowIso);
        counts.cleared++;
      } else if (!row.closed_at) {
        const last = row.last_emailed_at ? Date.parse(String(row.last_emailed_at)) : 0;
        if (now.getTime() - last >= REMIND_EVERY_DAYS * 86_400_000) {
          counts.reminded++;
          const sent = Number(row.emails_sent ?? 0) + 1;
          if (await email({ locationId: String(row.location_id), flag: String(row.flag), doneToken: String(row.done_token), reminder: sent })) await p.markEmailed(String(row.id), nowIso, sent);
        }
      }
    }
    for (const key of firing) {
      if (seen.has(key)) continue;
      const [locationId, flag] = key.split('|');
      counts.opened++;
      // The row goes in first with no email recorded, so the next sweep retries a failed email and never raises a second flag.
      const token = await p.openFlag(locationId, flag, nowIso);
      if (token && await email({ locationId, flag, doneToken: token.doneToken, reminder: 1 })) await p.markEmailed(token.id, nowIso, 1);
    }
    return { status: 200, body: { ok: true, ...counts } };
  }

  const locationId = body.location_id;
  if (!isLocation(locationId)) return refuse(400, 'bad_request');
  const actor = typeof body.actor === 'string' && ACTOR_RE.test(body.actor) ? body.actor : '';
  if (!actor) return refuse(400, 'bad_request');

  if (op === 'setup.read') {
    const { row, conflict } = await oneByLocation(p, locationId);
    if (conflict) return refuse(409, 'conflict');
    return row ? view(p, row) : { status: 200, body: { ok: true, found: false } };
  }

  if (op === 'setup.ensure') {
    const { row, conflict } = await oneByLocation(p, locationId);
    if (conflict) return refuse(409, 'conflict');
    if (row) return view(p, row);
    // Plan, region and address come from the signup record for this location. The browser sends none of them.
    const signup = await p.signupByLocation(locationId);
    if (!signup) return refuse(404, 'no_signup');
    const plan = mapPlan(signup.plan);
    const region = mapRegion(signup.region);
    const email = String(signup.contact_email ?? '').trim().toLowerCase();
    if (!plan || !region || !email) return refuse(409, 'signup_unroutable');
    const created = await p.insertSubmission({
      location_id: locationId, contact_email: email, plan, region, status: 'draft', last_saved_at: nowIso,
      studio_name: signup.company_name ?? null, first_name: signup.contact_first_name ?? null, last_name: signup.contact_last_name ?? null,
    });
    if (!created) {
      // Either two tabs raced (the row is there now) or this address already holds a draft. The second is a conflict for staff, never a merge.
      const again = await oneByLocation(p, locationId);
      return again.row ? view(p, again.row) : refuse(409, 'conflict');
    }
    await p.log(String(created.id), 'app_submission_created', actor, {});
    return view(p, created);
  }

  const { row, conflict } = await oneByLocation(p, locationId);
  if (conflict) return refuse(409, 'conflict');
  if (!row) return refuse(404, 'not_found');

  if (op === 'answers.save') {
    // Same rule as save-draft: a finalised row is never edited.
    if (row.status && row.status !== 'draft') return refuse(409, 'not_draft');
    const fields = cleanAnswers(body.fields);
    if (!fields) return refuse(400, 'bad_request');
    // The time consent was given, from this clock. Stamped each time it goes from not given to given.
    if (fields.consent_send_on_behalf === true && row.consent_send_on_behalf !== true) fields.consent_captured_at = nowIso;
    const step = body.last_step_completed;
    if (Number.isInteger(step) && (step as number) >= 0 && (step as number) <= 20) fields.last_step_completed = step;
    // Checked again in the write: a payment landing mid-save must not be edited over.
    const saved = await p.updateDraft(String(row.id), { ...fields, last_saved_at: nowIso });
    if (!saved) return refuse(409, 'not_draft');
    await p.log(String(row.id), 'app_answers_saved', actor, { fields: Object.keys(fields) });
    return view(p, saved);
  }

  if (op === 'task.save') {
    const surface = String(body.surface);
    const status = String(body.status);
    if (!VALID_SURFACES.has(surface) || !VALID_STATUSES.has(status)) return refuse(400, 'bad_request');
    if (!PAID_STATUSES.has(String(row.payment_status))) return refuse(403, 'unpaid');
    const tasks = await p.tasksFor(String(row.id));
    const existing = tasks.find((t) => t.surface === surface);
    // Staff own a tile once they start it. A late save from an open tab must not move it back in their queue.
    if (existing && (existing.status === 'in_progress' || existing.status === 'complete')) return refuse(409, 'staff_owned');
    const data = cleanTaskData(surface as SurfaceKey, (body.data && typeof body.data === 'object' ? body.data : {}) as Row);
    const wasOpen = !existing || existing.status === 'pending' || existing.status === 'no_account';
    const wait = THIRD_PARTY_WAITS[surface as SurfaceKey];
    if (body.waiting === true && !wait) return refuse(400, 'bad_request');
    // Leaving `waiting` out keeps a declared wait; a data re-save must not drop it.
    const waitPatch = body.waiting === undefined
      ? { waiting_on: existing?.waiting_on ?? null, waiting_since: existing?.waiting_since ?? null }
      : { waiting_on: body.waiting === true ? wait!.who : null, waiting_since: body.waiting === true ? (existing?.waiting_since ?? nowIso) : null };
    const wrote = await p.saveTaskIfStudios({
      submission_id: row.id, surface, status, data,
      studio_submitted_at: status === 'submitted' ? (existing?.studio_submitted_at ?? nowIso) : (existing?.studio_submitted_at ?? null),
      ...waitPatch,
    });
    if (!wrote) return refuse(409, 'staff_owned');
    if (wasOpen && (status === 'submitted' || status === 'no_account')) await p.postMessage(String(row.id), row.studio_name, taskMessage(surface as SurfaceKey, status));
    await p.log(String(row.id), 'app_task_saved', actor, { surface, status });
    return view(p, row);
  }

  return refuse(400, 'bad_request');
}
