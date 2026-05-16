// Quote-level magic-link helpers. Mirror of _shared/projects.ts: tokens
// are 64-char hex strings minted by create-quote, written to the row
// alongside a TTL, validated by portal-quote in constant time.
//
// Tokens are invalidated three ways:
//   1. token_expires_at in the past
//   2. quote.status is terminal (accepted / declined / expired / cancelled / revised)
//   3. quote.token is null (never issued, or admin manually revoked)

// deno-lint-ignore no-explicit-any
type Sb = any;

export interface QuoteTokenResult {
  ok: boolean;
  submissionId?: string | null;
  externalContactId?: string | null;
  status?: string | null;
  // When the token is valid the caller usually wants to know why it might
  // still be unusable for accept/decline. `terminalStatus` is true if the
  // quote moved past the open window — load can still surface a read-only
  // view, but action endpoints should refuse.
  terminalStatus?: boolean;
}

const TERMINAL_STATUSES = new Set([
  'accepted', 'declined', 'expired', 'cancelled', 'revised',
]);

export async function verifyQuoteToken(
  sb: Sb,
  quoteId: string,
  rawToken: string,
): Promise<QuoteTokenResult> {
  if (!rawToken || !quoteId) return { ok: false };
  const { data } = await sb
    .from('quotes')
    .select('id, submission_id, external_contact_id, token, token_expires_at, status')
    .eq('id', quoteId)
    .maybeSingle();
  if (!data || !data.token) return { ok: false };
  if (!constantTimeEq(data.token, rawToken)) return { ok: false };
  if (data.token_expires_at && new Date(data.token_expires_at).getTime() < Date.now()) {
    return { ok: false };
  }
  const status = (data.status as string) || null;
  return {
    ok: true,
    submissionId: data.submission_id || null,
    externalContactId: data.external_contact_id || null,
    status,
    terminalStatus: status ? TERMINAL_STATUSES.has(status) : false,
  };
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Public recipient-facing URL for a quote. Used by create-quote to build
// the link emailed to the recipient.
export function quoteClientUrl(opts: { origin: string; quoteId: string; token: string }): string {
  const base = opts.origin.replace(/\/$/, '');
  return `${base}/quote.html?q=${encodeURIComponent(opts.quoteId)}&t=${encodeURIComponent(opts.token)}`;
}
