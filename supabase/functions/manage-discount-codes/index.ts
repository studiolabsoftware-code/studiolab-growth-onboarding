// Discount code management. Create, update, toggle active. Open to any
// active admin user — same access model as catalog.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { normaliseDiscountCode } from '../_shared/discount-code.ts';

const VALID_KINDS = new Set(['percentage', 'fixed_amount']);
const VALID_CURRENCIES = new Set(['AUD', 'USD']);

function parseIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${v}`);
  return d.toISOString();
}

// Moved to _shared/discount-code.ts on 2026-08-21 so the checkout lookup imports the SAME function
// rather than keeping its own near-copy. The two had already drifted: this side collapsed internal
// whitespace to a hyphen, the reader did not, so "EARLY BIRD" was stored as "EARLY-BIRD" and could
// never be redeemed by typing it. Now there is one definition to get wrong instead of two.
const normaliseCode = normaliseDiscountCode;

function validatePayload(body: Record<string, unknown>): { ok: true; patch: Record<string, unknown> } | { ok: false; error: string } {
  const patch: Record<string, unknown> = {};

  if ('code' in body) {
    const code = normaliseCode(body.code);
    if (!code) return { ok: false, error: 'Code cannot be blank.' };
    if (!/^[A-Z0-9_.+\-]{1,60}$/.test(code)) {
      return { ok: false, error: 'Codes can be 1–60 characters: letters, numbers, hyphen, underscore, period, plus.' };
    }
    patch.code = code;
  }

  if ('kind' in body) {
    const kind = String(body.kind || '');
    if (!VALID_KINDS.has(kind)) return { ok: false, error: 'kind must be percentage or fixed_amount.' };
    patch.kind = kind;
  }

  if ('value' in body) {
    const value = Number(body.value);
    if (!Number.isInteger(value) || value <= 0) return { ok: false, error: 'value must be a positive integer.' };
    patch.value = value;
  }

  if ('applies_to_all' in body) patch.applies_to_all = !!body.applies_to_all;
  if ('applies_to_product_ids' in body) {
    const ids = Array.isArray(body.applies_to_product_ids) ? body.applies_to_product_ids.map(String) : [];
    if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
      return { ok: false, error: 'applies_to_product_ids must be a list of product UUIDs.' };
    }
    patch.applies_to_product_ids = ids;
  }

  if ('currency' in body) {
    const c = body.currency;
    if (c === null || c === '') patch.currency = null;
    else if (typeof c === 'string' && VALID_CURRENCIES.has(c)) patch.currency = c;
    else return { ok: false, error: 'currency must be AUD, USD, or null.' };
  }

  if ('valid_from' in body)  patch.valid_from  = parseIsoOrNull(body.valid_from);
  if ('valid_until' in body) patch.valid_until = parseIsoOrNull(body.valid_until);

  if ('max_redemptions' in body) {
    const v = body.max_redemptions;
    if (v === null || v === '') patch.max_redemptions = null;
    else {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) return { ok: false, error: 'max_redemptions must be a positive integer or null.' };
      patch.max_redemptions = n;
    }
  }

  if ('active' in body) patch.active = !!body.active;

  return { ok: true, patch };
}

// Combined-shape validation that mirrors the DB CHECK constraints. Saves an
// extra round-trip when the body is obviously wrong.
function crossFieldCheck(row: Record<string, unknown>): string | null {
  const kind = row.kind as string;
  const value = row.value as number;
  const currency = row.currency as string | null;
  const validFrom = row.valid_from as string | null;
  const validUntil = row.valid_until as string | null;

  if (kind === 'percentage') {
    if (value < 1 || value > 100) return 'Percentage codes must have value between 1 and 100.';
    if (currency) return 'Percentage codes must not specify a currency.';
  }
  if (kind === 'fixed_amount') {
    if (value < 1) return 'Fixed-amount codes must have value of at least 1 cent.';
    if (!currency) return 'Fixed-amount codes must specify a currency.';
  }
  if (validFrom && validUntil && new Date(validFrom) > new Date(validUntil)) {
    return 'valid_from must be before valid_until.';
  }
  return null;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Not authorised.' }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || '');
    const sb = adminClient();

    if (action === 'create') {
      const v = validatePayload(body);
      if (!v.ok) return jsonResponse({ ok: false, error: v.error }, 400);
      const required = ['code', 'kind', 'value'];
      for (const k of required) {
        if (!(k in v.patch)) return jsonResponse({ ok: false, error: `Missing ${k}.` }, 400);
      }
      v.patch.created_by = caller.id;
      if (!('active' in v.patch)) v.patch.active = true;
      if (!('applies_to_all' in v.patch)) v.patch.applies_to_all = true;

      const xerr = crossFieldCheck(v.patch);
      if (xerr) return jsonResponse({ ok: false, error: xerr }, 400);

      const { data, error } = await sb.from('discount_codes').insert(v.patch).select('*').single();
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          return jsonResponse({ ok: false, error: 'A code with that name already exists.' }, 409);
        }
        throw error;
      }
      return jsonResponse({ ok: true, code: data });
    }

    if (action === 'update') {
      const id = String(body.id || '');
      if (!id) return jsonResponse({ ok: false, error: 'Missing code id.' }, 400);
      const v = validatePayload(body);
      if (!v.ok) return jsonResponse({ ok: false, error: v.error }, 400);
      if (Object.keys(v.patch).length === 0) return jsonResponse({ ok: false, error: 'Nothing to update.' }, 400);

      // Merge with existing row for cross-field check.
      const { data: existing } = await sb.from('discount_codes').select('*').eq('id', id).maybeSingle();
      if (!existing) return jsonResponse({ ok: false, error: 'Code not found.' }, 404);
      const merged = { ...existing, ...v.patch };
      const xerr = crossFieldCheck(merged);
      if (xerr) return jsonResponse({ ok: false, error: xerr }, 400);

      const { data, error } = await sb.from('discount_codes').update(v.patch).eq('id', id).select('*').single();
      if (error) {
        if ((error as { code?: string }).code === '23505') {
          return jsonResponse({ ok: false, error: 'A code with that name already exists.' }, 409);
        }
        throw error;
      }
      return jsonResponse({ ok: true, code: data });
    }

    if (action === 'set_active') {
      const id = String(body.id || '');
      if (!id) return jsonResponse({ ok: false, error: 'Missing code id.' }, 400);
      const active = !!body.active;
      const { data, error } = await sb.from('discount_codes').update({ active }).eq('id', id).select('*').single();
      if (error) throw error;
      return jsonResponse({ ok: true, code: data });
    }

    return jsonResponse({ ok: false, error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('manage-discount-codes error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
