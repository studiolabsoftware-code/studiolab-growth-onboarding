// prebind.ts — turn the raw `?t=` pre-bind token from a StudioLAB Growth invite link into the
// studio's identity, server-side only.
//
// WHY THIS EXISTS. C1 (the Growth Connector's signup-webhook-receiver) emails a studio a link ending
// `?t=<raw token>` and stores only the token's HMAC. Without this module the form ignores the token,
// which is why a studio who clicked their own invite was still asked to type the email we already
// knew and then landed on a blank form.
//
// THE TOKEN NEVER UNLOCKS DATA IN THE BROWSER. It is a bearer credential sitting in an inbox, so a
// forwarded link must disclose nothing. The raw token travels to the server, and the server resolves
// it through growth_manager.resolve_signup_by_token, a SECURITY DEFINER RPC that does the HMAC
// INSIDE Postgres. Consequences worth stating plainly:
//   - neither send-otp nor verify-otp ever holds PREBIND_TOKEN_PEPPER, or any credential at all;
//   - the worst case for a leaked link is an OTP code mailed to the legitimate studio's own inbox;
//   - a client-supplied location_id is never trusted, because the client never supplies one.
//
// PURE + INJECTED. The RPC call is passed in, so every branch here is testable with `deno test` and
// no network. Nothing in this file logs, echoes, or stores the raw token.

/** The row shape growth_manager.resolve_signup_by_token returns. */
export interface PrebindRow {
  location_id: string | null;
  contact_email: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  company_name: string | null;
  plan: string | null;
  region: string | null;
  tier: string | null;
}

/** The tier-1 identity the form pre-fills with. */
export interface PrebindIdentity {
  locationId: string;
  contactEmail: string;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  /** Form vocabulary. null when the stored value did not map; the caller then falls back to the URL. */
  plan: 'launch' | 'scale' | 'ai' | null;
  /** null when the stored value did not map; same fallback. */
  region: 'AU' | 'US' | null;
}

// The receiver mints randomTokenHex(32) = 64 lowercase hex characters. The bound is a little wider so
// a future mint-length change does not silently stop resolving, and it is checked here as well as in
// the RPC so an obviously junk value never reaches the database at all.
const TOKEN_RE = /^[0-9a-fA-F]{32,128}$/;

/**
 * Mirrors resolveFormRoute's alias tables in the Connector
 * (signup-webhook-receiver/lib/email.ts). Kept identical on purpose: the invite URL and the draft
 * this seeds must agree about which plan a studio is on, and GHL sends display/internal values like
 * 'dominate-ai' rather than the form's 'ai'.
 */
const PLAN_ALIASES: Record<string, 'launch' | 'scale' | 'ai'> = {
  launch: 'launch',
  scale: 'scale',
  ai: 'ai',
  dominate: 'ai',
  dominateai: 'ai',
  'dominate-ai': 'ai',
  dominate_ai: 'ai',
  'dominate ai': 'ai',
};

const REGION_ALIASES: Record<string, 'AU' | 'US'> = {
  au: 'AU', aus: 'AU', australia: 'AU',
  us: 'US', usa: 'US', america: 'US', 'united states': 'US',
};

export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value.trim());
}

export function mapPlan(stored: string | null | undefined): 'launch' | 'scale' | 'ai' | null {
  return PLAN_ALIASES[String(stored ?? '').trim().toLowerCase()] ?? null;
}

export function mapRegion(stored: string | null | undefined): 'AU' | 'US' | null {
  return REGION_ALIASES[String(stored ?? '').trim().toLowerCase()] ?? null;
}

const clean = (v: string | null | undefined): string | null => {
  const s = String(v ?? '').trim();
  return s.length ? s : null;
};

/**
 * Map a resolved row to an identity, or null when the row cannot serve as one.
 *
 * A row WITHOUT a location_id or a contact_email is unusable: location_id is the binding key the
 * whole Scenario B thread hangs on, and without an address there is nowhere to send the code. Those
 * are treated as "unresolved" rather than half-resolved, so a caller can never act on a partial
 * identity.
 */
export function toIdentity(row: PrebindRow | null | undefined): PrebindIdentity | null {
  if (!row) return null;
  const locationId = clean(row.location_id);
  const contactEmail = clean(row.contact_email);
  if (!locationId || !contactEmail) return null;
  return {
    locationId,
    contactEmail: contactEmail.toLowerCase(),
    firstName: clean(row.contact_first_name),
    lastName: clean(row.contact_last_name),
    companyName: clean(row.company_name),
    plan: mapPlan(row.plan),
    region: mapRegion(row.region),
  };
}

/** Injected RPC caller: given the raw token, return whatever the RPC returned. */
export type ResolveRpc = (rawToken: string) => Promise<PrebindRow[] | PrebindRow | null>;

/**
 * Resolve a raw token to an identity. Returns null for every failure - malformed, unknown, empty
 * result, unusable row, or an RPC that threw. FAIL CLOSED and INDISTINGUISHABLE: a caller must not be
 * able to tell "no such token" from "malformed token" from "the database was briefly unavailable",
 * because that difference is exactly what makes a token oracle useful to an attacker.
 */
export async function resolvePrebind(
  rawToken: unknown,
  callRpc: ResolveRpc,
): Promise<PrebindIdentity | null> {
  if (!isWellFormedToken(rawToken)) return null;
  try {
    const result = await callRpc(rawToken.trim());
    const row = Array.isArray(result) ? (result[0] ?? null) : result;
    return toIdentity(row);
  } catch {
    // Deliberately swallowed, and deliberately not logged with the token in scope.
    return null;
  }
}

/**
 * Build the tier-1 seed for a draft submission: the fields we can fill because the studio already
 * told StudioLAB Growth at signup.
 *
 * NO-CLOBBER, and this is the load-bearing rule. Only a field the studio has left EMPTY is filled.
 * A studio coming back to a half-finished draft must never find their own typing rewritten by a
 * value from the signup payload, which may be older or simply less correct than what they entered.
 *
 * `location_id` follows the same rule rather than being forced. Overwriting an existing binding
 * would silently re-point a submission at a different sub-account, which is worse than leaving a
 * stale one for a human to notice.
 *
 * Returns a plain object safe to spread into an insert or an update. Empty when there is nothing to
 * add, so the caller never issues a write it did not intend.
 */
export function buildSeed(
  identity: PrebindIdentity | null,
  row: Record<string, unknown> | null,
): Record<string, string> {
  if (!identity) return {};
  const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
  const seed: Record<string, string> = {};
  if (identity.companyName && blank(row?.studio_name)) seed.studio_name = identity.companyName;
  if (identity.firstName && blank(row?.first_name)) seed.first_name = identity.firstName;
  if (identity.lastName && blank(row?.last_name)) seed.last_name = identity.lastName;
  if (blank(row?.location_id)) seed.location_id = identity.locationId;
  return seed;
}
