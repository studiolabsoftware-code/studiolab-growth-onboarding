// Mailgun sender. Reads env at call time so deployment env vars are honoured.

interface Attachment {
  filename: string;
  content: Uint8Array;
  contentType?: string;
}

interface SendArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: Attachment[];
  // Arbitrary RFC822 headers (Message-Id, In-Reply-To, References, etc).
  // Mailgun expects them as form fields prefixed with `h:`.
  headers?: Record<string, string>;
}

export async function sendEmail(args: SendArgs): Promise<void> {
  const apiKey = Deno.env.get('MAILGUN_API_KEY');
  const domain = Deno.env.get('MAILGUN_DOMAIN');
  const from = Deno.env.get('MAILGUN_FROM') || `StudioLAB Growth <growth@${domain}>`;
  if (!apiKey || !domain) throw new Error('Mailgun env vars missing.');

  const form = new FormData();
  form.append('from', from);
  const toList = Array.isArray(args.to) ? args.to : [args.to];
  toList.forEach((addr) => form.append('to', addr));
  form.append('subject', args.subject);
  form.append('html', args.html);
  if (args.text) form.append('text', args.text);
  if (args.replyTo) form.append('h:Reply-To', args.replyTo);
  // Disable Mailgun's link-tracking proxy and open-tracking pixel by
  // default. Click tracking rewrites every <a href> to go through
  // `email.<domain>/c/...` and requires the click-tracking CNAME to be
  // configured separately; without it, clicks navigate to an
  // unresolvable host. We have no analytics consumer for either signal,
  // so disable them outright on transactional sends.
  form.append('o:tracking-clicks', 'no');
  form.append('o:tracking-opens', 'no');
  if (args.headers) {
    for (const [name, value] of Object.entries(args.headers)) {
      if (value) form.append(`h:${name}`, value);
    }
  }
  if (args.attachments) {
    for (const att of args.attachments) {
      const blob = new Blob([att.content], { type: att.contentType || 'application/octet-stream' });
      form.append('attachment', blob, att.filename);
    }
  }

  const auth = btoa('api:' + apiKey);
  const resp = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}` },
    body: form,
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Mailgun send failed (${resp.status}): ${body}`);
  }
}
