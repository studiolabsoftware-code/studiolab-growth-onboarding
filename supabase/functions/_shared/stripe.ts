// Tiny Stripe HTTP helper. We deliberately avoid the official Stripe SDK so
// the Deno bundle stays small and we keep one obvious place for retries,
// auth, and version pinning. Pulls the secret key from env using the current
// stripe_mode in payment_settings.

import { adminClient } from './supabase.ts';

const API_VERSION = '2024-12-18.acacia';

export type StripeMode = 'test' | 'live';

export async function getStripeMode(): Promise<StripeMode> {
  const sb = adminClient();
  const { data } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
  return ((data?.stripe_mode as StripeMode) || 'test');
}

export function getStripeKey(mode: StripeMode): string {
  const name = mode === 'live' ? 'STRIPE_SECRET_KEY_LIVE' : 'STRIPE_SECRET_KEY_TEST';
  const key = Deno.env.get(name);
  if (!key) throw new Error(`Edge Function secret ${name} is not set.`);
  return key;
}

// Encode a JS object as x-www-form-urlencoded with Stripe-style bracket
// notation for nested objects (metadata[key], expand[]). Stripe's REST API
// does not accept JSON for writes; everything is form-encoded.
export function stripeEncode(obj: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') {
          parts.push(stripeEncode(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === 'object') {
      parts.push(stripeEncode(v as Record<string, unknown>, key));
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

export type StripeResult<T> = { ok: boolean; status: number; body: T; error?: string };

export async function stripeRequest<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body: Record<string, unknown> | null,
  secretKey: string,
  idempotencyKey?: string,
): Promise<StripeResult<T>> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${secretKey}`,
    'Stripe-Version': API_VERSION,
  };
  if (method !== 'GET') headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const init: RequestInit = { method, headers };
  if (body && method !== 'GET') init.body = stripeEncode(body);

  const resp = await fetch(`https://api.stripe.com/v1/${path}`, init);
  let parsed: unknown = {};
  try { parsed = await resp.json(); } catch (_) { parsed = {}; }
  const obj = parsed as { error?: { message?: string } };
  return {
    ok: resp.ok,
    status: resp.status,
    body: parsed as T,
    error: !resp.ok ? (obj?.error?.message || `Stripe responded ${resp.status}`) : undefined,
  };
}

// Verify a Stripe-Signature header against the raw request body. Header
// format: t=<timestamp>,v1=<sig>[,v0=<sig>]. The signed payload is
// `${timestamp}.${rawBody}` and the digest is HMAC-SHA256 of that string
// using the webhook signing secret. We try every secret supplied (test and
// live) and accept whichever validates. Timestamps older than the tolerance
// are rejected to defeat replay.
export async function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | null,
  secrets: string[],
  toleranceSeconds = 300,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!sigHeader) return { ok: false, error: 'Missing Stripe-Signature header.' };
  const usableSecrets = secrets.filter((s) => typeof s === 'string' && s.length > 0);
  if (usableSecrets.length === 0) {
    return { ok: false, error: 'No Stripe webhook signing secret configured.' };
  }

  let t = '';
  const v1s: string[] = [];
  for (const part of sigHeader.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') v1s.push(v);
  }
  if (!t || v1s.length === 0) return { ok: false, error: 'Malformed Stripe-Signature header.' };

  const ts = Number(t);
  if (!Number.isFinite(ts)) return { ok: false, error: 'Invalid signature timestamp.' };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSeconds) {
    return { ok: false, error: 'Signature timestamp outside tolerance.' };
  }

  const enc = new TextEncoder();
  const payload = enc.encode(`${t}.${rawBody}`);

  for (const secret of usableSecrets) {
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sigBuf = await crypto.subtle.sign('HMAC', key, payload);
    const expected = Array.from(new Uint8Array(sigBuf))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    for (const v1 of v1s) {
      if (constantTimeEqualHex(expected, v1)) return { ok: true };
    }
  }
  return { ok: false, error: 'Stripe signature mismatch.' };
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
