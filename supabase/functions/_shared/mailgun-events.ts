// Read-only delivery status for a recipient, straight from Mailgun's Events
// API. Used when escalating a stalled onboarding to the account owner, so the
// alert can answer the question that actually decides what to do next: did our
// emails reach them at all?
//
// A studio who was never reached needs a phone call. A studio who opened three
// emails and did nothing needs a different conversation. Without this the two
// look identical from our side, which is the whole reason the escalation exists.
//
// Deliberately a live query rather than a stored ledger. The Connector has a
// mailgun-event-webhook that records every event into growth_manager.email_event
// for analytics; that is the right long-term source and this does not replace
// it. It is also not deployed. This asks Mailgun directly for one recipient at
// the moment we need it, which needs no webhook, no table, and no backfill.
//
// Never throws. A delivery lookup failing must not stop an escalation going
// out; "unknown" is a usable answer and silence is not.

export interface DeliveryStatus {
  /** True when Mailgun confirmed at least one delivery to this address. */
  delivered: boolean;
  /** True when at least one message was opened. Only meaningful if tracking is on. */
  opened: boolean;
  /** Permanent failure: bad address, blocked, or the domain rejected us. */
  bounced: boolean;
  /** Recipient hit "report spam". The strongest possible do-not-contact signal. */
  complained: boolean;
  /** Most recent failure reason Mailgun gave, when there is one. */
  failureReason?: string;
  /** False when the lookup could not run (no credentials, API error, timeout). */
  known: boolean;
  /** One-line summary for an email body. */
  summary: string;
}

const UNKNOWN: DeliveryStatus = {
  delivered: false, opened: false, bounced: false, complained: false,
  known: false, summary: 'Delivery status unavailable',
};

export async function lookupDeliveryStatus(
  recipient: string,
  sinceDaysAgo = 30,
): Promise<DeliveryStatus> {
  const apiKey = Deno.env.get('MAILGUN_API_KEY');
  const domain = Deno.env.get('MAILGUN_DOMAIN');
  if (!apiKey || !domain || !recipient) return UNKNOWN;

  try {
    const begin = Math.floor(Date.now() / 1000) - sinceDaysAgo * 86400;
    const url = new URL(`https://api.mailgun.net/v3/${domain}/events`);
    url.searchParams.set('recipient', recipient);
    url.searchParams.set('begin', String(begin));
    url.searchParams.set('ascending', 'no');
    url.searchParams.set('limit', '100');

    // A slow Mailgun must not hold up the nightly run.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    let resp: Response;
    try {
      resp = await fetch(url.toString(), {
        headers: { Authorization: 'Basic ' + btoa(`api:${apiKey}`) },
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return UNKNOWN;

    const data = await resp.json();
    const items: Array<Record<string, unknown>> = Array.isArray(data?.items) ? data.items : [];

    let delivered = false, opened = false, bounced = false, complained = false;
    let failureReason: string | undefined;

    for (const it of items) {
      const ev = String(it.event || '').toLowerCase();
      if (ev === 'delivered') delivered = true;
      else if (ev === 'opened') opened = true;
      else if (ev === 'complained') complained = true;
      else if (ev === 'failed' || ev === 'rejected') {
        // Mailgun splits failures into permanent and temporary. A temporary
        // one is a retry in progress, not a reason to tell anyone the studio
        // is unreachable.
        const severity = String(it.severity || '').toLowerCase();
        if (severity !== 'temporary') {
          bounced = true;
          if (!failureReason) {
            const dm = it['delivery-status'] as Record<string, unknown> | undefined;
            failureReason = String(dm?.message || dm?.description || it.reason || 'permanent failure').slice(0, 200);
          }
        }
      }
    }

    let summary: string;
    if (complained) summary = 'Marked as spam by the recipient';
    else if (bounced) summary = `Bounced: ${failureReason || 'permanent failure'}`;
    else if (opened) summary = 'Delivered and opened';
    else if (delivered) summary = 'Delivered, never opened';
    else if (items.length === 0) summary = 'No email events found for this address';
    else summary = 'Sent, no delivery confirmation yet';

    return { delivered, opened, bounced, complained, failureReason, known: true, summary };
  } catch (_err) {
    return UNKNOWN;
  }
}
