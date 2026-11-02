// Server-to-server request signing (ARCHITECTURE-SECURITY-STANDARD.md, the bridge controls): a secret per
// direction, an HMAC over method, path, timestamp, nonce and the exact body, skew rejection, a constant-time
// compare (crypto.subtle.verify), and stored nonces. No dependencies, so it runs under `deno test`.
//
// The dashboard server signs the same string: server/src/onboarding/client.ts in the Growth Dashboard repo.

export const S2S_SKEW_SECONDS = 300;
export const S2S_MIN_SECRET_LENGTH = 32;
const NONCE_RE = /^[0-9a-f]{32,64}$/;
const SIGNATURE_RE = /^[0-9a-f]{64}$/;
const TIMESTAMP_RE = /^[0-9]{1,12}$/;

export type S2sDirection = 'dashboard-to-onboarding';
export type S2sRefusal = 'not_configured' | 'malformed' | 'stale' | 'bad_signature' | 'replay';

const encoder = new TextEncoder();
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

export async function canonicalString(direction: S2sDirection, method: string, path: string, timestamp: string, nonce: string, body: string): Promise<string> {
  const bodyHash = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
  return ['v1', direction, method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
}

const key = (secret: string, usage: KeyUsage) =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

export async function signS2s(secret: string, canonical: string): Promise<string> {
  return hex(await crypto.subtle.sign('HMAC', await key(secret, 'sign'), encoder.encode(canonical)));
}

export interface S2sInput {
  direction: S2sDirection;
  method: string;
  path: string;
  body: string;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
  /** The current secret, then the previous one during a rotation. Short or blank ones are ignored. */
  secrets: Array<string | undefined>;
  nowSeconds: number;
  /** Records the nonce. False when it was already there. Called only after the signature passes. */
  claimNonce: (nonce: string, expiresAtSeconds: number) => Promise<boolean>;
}

/** Null when the request is genuine and new; otherwise why it was refused. The reason is for the log, never the caller. */
export async function verifyS2s(i: S2sInput): Promise<S2sRefusal | null> {
  const secrets = i.secrets.filter((s): s is string => typeof s === 'string' && s.length >= S2S_MIN_SECRET_LENGTH);
  if (!secrets.length) return 'not_configured';
  if (!i.timestamp || !TIMESTAMP_RE.test(i.timestamp) || !i.nonce || !NONCE_RE.test(i.nonce) || !i.signature || !SIGNATURE_RE.test(i.signature)) return 'malformed';
  if (Math.abs(i.nowSeconds - Number(i.timestamp)) > S2S_SKEW_SECONDS) return 'stale';
  const canonical = encoder.encode(await canonicalString(i.direction, i.method, i.path, i.timestamp, i.nonce, i.body));
  const given = unhex(i.signature);
  let good = false;
  for (const secret of secrets) {
    if (await crypto.subtle.verify('HMAC', await key(secret, 'verify'), given, canonical)) good = true;
  }
  if (!good) return 'bad_signature';
  // Kept past the far edge of the skew window, so a replay can never outlive its nonce.
  return (await i.claimNonce(i.nonce, Number(i.timestamp) + S2S_SKEW_SECONDS * 2)) ? null : 'replay';
}
