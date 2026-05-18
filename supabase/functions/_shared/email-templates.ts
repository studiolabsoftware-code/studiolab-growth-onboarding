// StudioLAB Growth email templates. Inline-styled HTML, dark indigo header,
// brand logo, white body card, indigo CTA.

// Hosted via jsdelivr CDN (mirrors the public repo). HTTPS guaranteed, fast,
// and independent of the app subdomain's cert state.
const LOGO_URL = 'https://cdn.jsdelivr.net/gh/studiolabsoftware-code/studiolab-growth-onboarding@main/assets/growth-logo-email.png';

const COL = {
  in_d: '#13102E',
  in:   '#4A3F8A',
  mg:   '#E8197F',
  g1:   '#F2F3F7',
  g2:   '#DFE0EC',
  g6:   '#4A4C65',
  g8:   '#13102E',
};

function layout(opts: { previewText: string; body: string }): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${COL.g1};font-family:'Inter',Arial,sans-serif;color:${COL.g8};">
<div style="display:none;max-height:0;overflow:hidden;">${escape(opts.previewText)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COL.g1};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
      <tr><td style="background:${COL.in_d};padding:22px 32px;border-radius:12px 12px 0 0;text-align:left;">
        <img src="${LOGO_URL}" alt="StudioLAB Growth" width="127" height="30" style="display:block;height:30px;width:auto;border:0;outline:none;text-decoration:none;">
      </td></tr>
      <tr><td style="background:#fff;padding:32px;border-radius:0 0 12px 12px;font-size:14px;line-height:1.6;color:${COL.g8};">
        ${opts.body}
      </td></tr>
      <tr><td style="padding:20px 8px;text-align:center;color:${COL.g6};font-size:11px;">
        StudioLAB Growth, sent automatically from your onboarding system.<br>
        If you did not expect this email, please ignore it.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function cta(label: string, url: string): string {
  // Bulletproof button: background + border-radius live on the <a>
  // itself, not the wrapping <td>. Previous shape (colored <td> + plain
  // <a> inside) failed in Gmail when display:inline-block was stripped:
  // only the text glyphs were clickable while the surrounding colored
  // pill was dead space. Putting the visible styling on the <a> means
  // the whole pill IS the link in every renderer.
  //
  // Escape the URL — unescaped `&` in href values is invalid HTML and
  // some clients mangle `&t=…` as a malformed entity.
  //
  // target="_blank" + rel="noopener noreferrer" so Gmail opens the link
  // in a new tab instead of suppressing the same-tab navigation.
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>
    <td>
      <a href="${escape(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:${COL.in};color:#fff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;line-height:1;mso-padding-alt:0;">${escape(label)}</a>
    </td></tr></table>`;
}

export function submissionConfirmation(opts: { studioName: string; ref: string }): { subject: string; html: string } {
  const subject = `We have your StudioLAB Growth details, ${opts.studioName}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Thanks, we have everything we need</h1>
    <p style="margin:0 0 14px;">Hi from the StudioLAB team. Your onboarding details have come through and we are getting started.</p>
    <p style="margin:0 0 14px;">A team member will review what you sent and reach out shortly to confirm next steps. If anything is missing, we will send you a quick link to add it without filling out the whole form again.</p>
    <p style="margin:0 0 6px;color:${COL.g6};font-size:12px;">Your reference</p>
    <p style="margin:0 0 18px;font-family:'JetBrains Mono',Menlo,monospace;font-size:14px;color:${COL.in_d};font-weight:700;">${escape(opts.ref)}</p>
    <p style="margin:0;">Speak soon,<br>The StudioLAB team</p>`;
  return { subject, html: layout({ previewText: 'We have your StudioLAB Growth onboarding details.', body }) };
}

// Mode-aware payment confirmation emails. Sent by the stripe-webhook function
// when checkout.session.completed lands. The phrasing matches the three
// timing modes documented in stripe-integration-plan.md so studios are not
// surprised by a hold or a saved-card scenario showing up on their statement.
function formatAmountDisplay(opts: { amountCents: number; currency: string; includesGst: boolean }): string {
  const dollars = (opts.amountCents / 100).toFixed(2);
  const gstNote = opts.includesGst ? ' (incl. GST)' : '';
  return `${opts.currency} $${dollars}${gstNote}`;
}

// Optional GST-breakdown block. Shown only when we know the tax portion
// separately from the total (i.e. session.total_details.amount_tax was
// populated). Falls back to the simple amount display when tax info is
// not available.
function formatPaymentBreakdown(opts: {
  amountCents: number;          // Total paid (incl. GST for AU)
  taxCents: number | null;
  currency: string;
}): string {
  if (!opts.taxCents || opts.taxCents <= 0) {
    return `<p style="margin:0 0 14px;font-size:14px;">Total paid: <strong>${opts.currency} $${(opts.amountCents / 100).toFixed(2)}</strong></p>`;
  }
  const subtotal = opts.amountCents - opts.taxCents;
  const tax = opts.taxCents;
  const total = opts.amountCents;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px;font-size:13px;">
      <tr><td style="padding:4px 0;color:#666;">Subtotal</td><td style="padding:4px 0;text-align:right;">${opts.currency} $${(subtotal / 100).toFixed(2)}</td></tr>
      <tr><td style="padding:4px 0;color:#666;">GST (10%)</td><td style="padding:4px 0;text-align:right;">${opts.currency} $${(tax / 100).toFixed(2)}</td></tr>
      <tr><td style="padding:6px 0;border-top:1px solid #ddd;font-weight:700;">Total paid</td><td style="padding:6px 0;border-top:1px solid #ddd;text-align:right;font-weight:700;">${opts.currency} $${(total / 100).toFixed(2)}</td></tr>
    </table>`;
}

export { formatAmountDisplay, formatPaymentBreakdown };

export function paymentReceiptImmediate(opts: {
  studioName: string;
  ref: string;
  amountCents: number;            // GST-inclusive total for AU
  taxCents?: number | null;       // GST portion only (when known)
  currency: string;
  includesGst: boolean;
  invoiceUrl?: string | null;
  accountUrl?: string | null;     // /account.html link for the studio
}): { subject: string; html: string } {
  const amountDisplay = formatAmountDisplay(opts);
  const subject = `Payment received: StudioLAB Growth setup for ${opts.studioName}`;
  const invoiceLine = opts.invoiceUrl
    ? `<p style="margin:0 0 14px;">A tax invoice is attached to the receipt Stripe sent you, and you can also <a href="${escape(opts.invoiceUrl)}" style="color:${COL.in};">view it online here</a>.</p>`
    : `<p style="margin:0 0 14px;">A tax invoice is on its way to your inbox.</p>`;
  const breakdown = formatPaymentBreakdown({
    amountCents: opts.amountCents,
    taxCents: opts.taxCents ?? null,
    currency: opts.currency,
  });
  const accountCta = opts.accountUrl
    ? cta('View your account', opts.accountUrl)
    : '';
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Payment received</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.studioName)},</p>
    <p style="margin:0 0 14px;">Thanks for your StudioLAB Growth setup payment. Your onboarding details are locked in and our team will be in touch shortly to begin the work.</p>
    ${breakdown}
    ${invoiceLine}
    ${accountCta}
    <p style="margin:0 0 6px;color:${COL.g6};font-size:12px;">Your reference</p>
    <p style="margin:0 0 18px;font-family:'JetBrains Mono',Menlo,monospace;font-size:14px;color:${COL.in_d};font-weight:700;">${escape(opts.ref)}</p>
    <p style="margin:0;">Speak soon,<br>The StudioLAB team</p>`;
  return { subject, html: layout({ previewText: `Payment received: ${amountDisplay}`, body }) };
}

export function paymentReceiptHold(opts: {
  studioName: string;
  ref: string;
  amountCents: number;
  currency: string;
  includesGst: boolean;
  accountUrl?: string | null;
}): { subject: string; html: string } {
  const amountDisplay = formatAmountDisplay(opts);
  const subject = `Card authorised: StudioLAB Growth setup for ${opts.studioName}`;
  const accountCta = opts.accountUrl
    ? cta('View your account', opts.accountUrl)
    : '';
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Your card has been authorised</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.studioName)},</p>
    <p style="margin:0 0 14px;">Your card has been authorised for <strong>${escape(amountDisplay)}</strong>. We have not taken the funds yet. We will only complete the charge once your setup begins, and you may see a pending authorisation on your statement until then.</p>
    <p style="margin:0 0 14px;">Your onboarding details are saved and our team will be in touch shortly to schedule the work.</p>
    ${accountCta}
    <p style="margin:0 0 6px;color:${COL.g6};font-size:12px;">Your reference</p>
    <p style="margin:0 0 18px;font-family:'JetBrains Mono',Menlo,monospace;font-size:14px;color:${COL.in_d};font-weight:700;">${escape(opts.ref)}</p>
    <p style="margin:0;">Speak soon,<br>The StudioLAB team</p>`;
  return { subject, html: layout({ previewText: `Card authorised: ${amountDisplay}`, body }) };
}

export function paymentReceiptSaveCard(opts: {
  studioName: string;
  ref: string;
  amountCents: number;
  currency: string;
  includesGst: boolean;
  accountUrl?: string | null;
}): { subject: string; html: string } {
  const amountDisplay = formatAmountDisplay(opts);
  const subject = `Card saved: StudioLAB Growth setup for ${opts.studioName}`;
  const accountCta = opts.accountUrl
    ? cta('View your account', opts.accountUrl)
    : '';
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Your card has been saved securely</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.studioName)},</p>
    <p style="margin:0 0 14px;">Your card has been saved securely with our payment provider. We will charge <strong>${escape(amountDisplay)}</strong> when we begin your setup, and you will receive a tax invoice at that time. You will not see a pending charge on your statement until then.</p>
    <p style="margin:0 0 14px;">Your onboarding details are saved and our team will be in touch shortly with timing.</p>
    ${accountCta}
    <p style="margin:0 0 6px;color:${COL.g6};font-size:12px;">Your reference</p>
    <p style="margin:0 0 18px;font-family:'JetBrains Mono',Menlo,monospace;font-size:14px;color:${COL.in_d};font-weight:700;">${escape(opts.ref)}</p>
    <p style="margin:0;">Speak soon,<br>The StudioLAB team</p>`;
  return { subject, html: layout({ previewText: `Card saved: ${amountDisplay} will be charged when setup begins`, body }) };
}

// Submission-row shape (subset). All fields are optional in the email
// digest — missing values render as "—" without breaking the table.
export interface SubmissionRowLike {
  studio_name?: string | null;
  legal_name?: string | null;
  country?: string | null;
  timezone?: string | null;
  studio_type?: string | null;
  address?: string | null;
  website?: string | null;
  support_url?: string | null;

  first_name?: string | null;
  last_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  role?: string | null;
  studiolab_email?: string | null;

  logo_url?: string | null;
  primary_colour?: string | null;
  secondary_colour?: string | null;
  sign_off?: string | null;
  email_tone?: string | null;
  footer_notes?: string | null;
  studio_description?: string | null;

  from_name?: string | null;
  reply_email?: string | null;
  custom_domain?: boolean | null;
  email_domain?: string | null;
  dns_access?: string | null;

  sms_type?: string | null;
  area_code?: string | null;
  port_number?: string | null;
  sms_tone?: string | null;
  lead_sources?: unknown;

  kb_greeting?: string | null;
  kb_assistant_persona_type?: string | null;
  kb_assistant_persona_name?: string | null;
  kb_profile?: string | null;
  kb_classes?: string | null;
  kb_pricing?: string | null;
  kb_price_quoting?: string | null;
  kb_policies?: string | null;
  kb_events?: string | null;
  kb_faqs?: string | null;
  kb_restricted?: string | null;
  kb_tone?: string | null;
  voice_hours?: string | null;
  voice_escalate?: string | null;

  extra_notes?: string | null;
  plan?: string | null;
  setup_type?: string | null;
}

export interface AttachmentDigestRow {
  file_name: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  uploaded_at?: string | null;
  expires_at?: string | null;
  download_url?: string | null;  // when set, rendered as a link
}

// Builds a rich, copy-friendly HTML digest of the submission. Designed to
// paste cleanly from Gmail (or any HTML-capable mail client) into GHL — the
// 2-column tables become TAB-separated rows in plaintext targets, and
// long-form fields (descriptions, policies) get their own labelled block so
// they're selectable as one chunk.
//
// VAs are the target reader. Each section can be select+copied independently;
// the layout mirrors the admin detail page's section structure so muscle
// memory transfers.
//
// `attachments` is optional — when provided, an Attachments section is
// appended to the digest with filename, size, and a download link per file.
// Download URLs should be the admin-side dashboard URL (or pre-signed
// Storage URL) — anything that opens to the file when an admin clicks.
export function submissionDigestHtml(sub: SubmissionRowLike, attachments?: AttachmentDigestRow[]): string {
  const v = (x: unknown): string => {
    if (x === null || x === undefined || x === '') return '—';
    if (Array.isArray(x)) return x.length ? x.join(', ') : '—';
    if (typeof x === 'boolean') return x ? 'Yes' : 'No';
    return String(x);
  };
  const isAi = sub.plan === 'ai';
  const isScale = sub.plan === 'scale';

  const rowsTable = (rows: Array<[string, unknown]>) => `
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;color:${COL.g8};">
      ${rows.map(([label, value]) => `
        <tr>
          <td style="padding:8px 12px 8px 0;color:${COL.g6};white-space:nowrap;vertical-align:top;width:38%;">${escape(label)}</td>
          <td style="padding:8px 0;vertical-align:top;color:${COL.in_d};">${escape(v(value))}</td>
        </tr>
      `).join('')}
    </table>`;

  // Long-form fields get their own labelled card so the value is selectable
  // as one block (Gmail handles select-around-a-div cleanly).
  const longField = (label: string, value: unknown) => {
    const text = v(value);
    if (text === '—') return '';
    return `
      <div style="margin:8px 0 12px;">
        <div style="font-size:11px;color:${COL.g6};text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px;font-weight:700;">${escape(label)}</div>
        <div style="background:${COL.g1};border:1px solid ${COL.g2};border-radius:8px;padding:10px 12px;white-space:pre-wrap;font-size:13px;line-height:1.55;color:${COL.in_d};">${escape(text)}</div>
      </div>`;
  };

  const sectionWrap = (title: string, inner: string) => `
    <div style="margin:24px 0 0;">
      <h2 style="margin:0 0 10px;font-size:13px;font-weight:700;color:${COL.in_d};letter-spacing:0.4px;text-transform:uppercase;">${escape(title)}</h2>
      <div style="border-top:1px solid ${COL.g2};padding-top:10px;">${inner}</div>
    </div>`;

  const sections: string[] = [];

  sections.push(sectionWrap('Studio details', rowsTable([
    ['Studio name', sub.studio_name],
    ['Legal name', sub.legal_name],
    ['Country', sub.country],
    ['Timezone', sub.timezone],
    ['Studio type', sub.studio_type],
    ['Address', sub.address],
    ['Website', sub.website],
    ['Support URL', sub.support_url],
  ])));

  sections.push(sectionWrap('Primary contact', rowsTable([
    ['First name', sub.first_name],
    ['Last name', sub.last_name],
    ['Email', sub.contact_email],
    ['Phone', sub.contact_phone],
    ['Role', sub.role],
    ['StudioLAB login email', sub.studiolab_email],
  ])));

  sections.push(sectionWrap('Branding', rowsTable([
    ['Logo URL', sub.logo_url],
    ['Primary colour', sub.primary_colour],
    ['Secondary colour', sub.secondary_colour],
    ['Sign-off', sub.sign_off],
    ['Email tone', sub.email_tone],
  ]) + longField('Studio description', sub.studio_description) + longField('Footer notes', sub.footer_notes)));

  sections.push(sectionWrap('Email setup', rowsTable([
    ['From name', sub.from_name],
    ['Reply-to', sub.reply_email],
    ['Custom domain', sub.custom_domain],
    ['Email domain', sub.email_domain],
    ['DNS access', sub.dns_access],
  ])));

  if (isScale || isAi) {
    sections.push(sectionWrap('SMS & social', rowsTable([
      ['Number preference', sub.sms_type],
      ['Area code', sub.area_code],
      ['Port number', sub.port_number],
      ['Lead sources', sub.lead_sources],
    ]) + longField('SMS tone notes', sub.sms_tone)));
  }

  if (isAi) {
    const persona = sub.kb_assistant_persona_type === 'named' && sub.kb_assistant_persona_name
      ? `Named: ${sub.kb_assistant_persona_name}`
      : 'Studio name';
    sections.push(sectionWrap('AI knowledge base', rowsTable([
      ['Assistant persona', persona],
      ['AI tone', sub.kb_tone],
      ['Voice agent hours', sub.voice_hours],
    ])
      + longField('Greeting', sub.kb_greeting)
      + longField('Studio profile', sub.kb_profile)
      + longField('Classes & timetable', sub.kb_classes)
      + longField('Pricing', sub.kb_pricing)
      + longField('Pricing guardrail', sub.kb_price_quoting)
      + longField('Policies', sub.kb_policies)
      + longField('Events', sub.kb_events)
      + longField('FAQs', sub.kb_faqs)
      + longField('Restricted topics', sub.kb_restricted)
      + longField('Voice escalation', sub.voice_escalate)));
  }

  if (sub.extra_notes) {
    sections.push(sectionWrap('Additional notes', longField('Notes', sub.extra_notes)));
  }

  if (attachments && attachments.length) {
    const bytes = (n?: number | null) => {
      if (!n) return '—';
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
      return `${(n / 1024 / 1024).toFixed(1)} MB`;
    };
    const attachRows = attachments.map((a) => `
      <tr>
        <td style="padding:8px 12px 8px 0;vertical-align:top;color:${COL.in_d};">${escape(a.file_name)}</td>
        <td style="padding:8px 12px 8px 0;vertical-align:top;color:${COL.g6};white-space:nowrap;">${escape(bytes(a.size_bytes))}</td>
        <td style="padding:8px 0;vertical-align:top;">
          ${a.download_url
            ? `<a href="${escape(a.download_url)}" style="color:${COL.in};font-weight:600;text-decoration:none;">Download →</a>`
            : `<span style="color:${COL.g6};">Open admin to download</span>`}
        </td>
      </tr>
    `).join('');
    sections.push(sectionWrap('Attachments', `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;">
        ${attachRows}
      </table>
      <p style="margin:10px 0 0;color:${COL.g6};font-size:11px;line-height:1.55;">
        Files auto-delete 7 days after the submission is marked complete, or after 90 days if it doesn't complete.
      </p>
    `));
  }

  return sections.join('');
}

export function adminPaymentLanded(opts: {
  studioName: string;
  plan: string;
  setup: string;
  mode: 'immediate' | 'hold' | 'save_card';
  amountCents: number;
  currency: string;
  includesGst: boolean;
  adminUrl: string;
  submission?: SubmissionRowLike;
  attachments?: AttachmentDigestRow[];
}): { subject: string; html: string } {
  const modeLabel = opts.mode === 'immediate' ? 'paid (immediate capture)'
    : opts.mode === 'hold' ? 'authorised (manual capture pending)'
    : 'card saved (off-session charge pending)';
  const amountDisplay = formatAmountDisplay(opts);
  const subject = `Payment ${opts.mode === 'immediate' ? 'received' : opts.mode === 'hold' ? 'authorised' : 'card saved'}: ${opts.studioName} (${opts.plan})`;
  const summary = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Payment landed</h1>
    <p style="margin:0 0 6px;"><strong>Studio:</strong> ${escape(opts.studioName)}</p>
    <p style="margin:0 0 6px;"><strong>Plan:</strong> ${escape(opts.plan)}</p>
    <p style="margin:0 0 6px;"><strong>Setup:</strong> ${escape(opts.setup)}</p>
    <p style="margin:0 0 6px;"><strong>Amount:</strong> ${escape(amountDisplay)}</p>
    <p style="margin:0 0 18px;"><strong>Status:</strong> ${escape(modeLabel)}</p>
    ${cta('Open in dashboard', opts.adminUrl)}`;
  const digest = opts.submission ? submissionDigestHtml(opts.submission, opts.attachments) : '';
  return { subject, html: layout({ previewText: `Payment ${modeLabel} for ${opts.studioName}`, body: summary + digest }) };
}

export function adminNewSubmission(opts: {
  studioName: string;
  plan: string;
  setup: string;
  adminUrl: string;
  submission?: SubmissionRowLike;
  attachments?: AttachmentDigestRow[];
}): { subject: string; html: string } {
  const subject = `New Growth onboarding: ${opts.studioName} (${opts.plan})`;
  const summary = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">New onboarding submission</h1>
    <p style="margin:0 0 6px;"><strong>Studio:</strong> ${escape(opts.studioName)}</p>
    <p style="margin:0 0 6px;"><strong>Plan:</strong> ${escape(opts.plan)}</p>
    <p style="margin:0 0 18px;"><strong>Setup:</strong> ${escape(opts.setup)}</p>
    ${cta('Open in dashboard', opts.adminUrl)}`;
  const digest = opts.submission ? submissionDigestHtml(opts.submission, opts.attachments) : '';
  return { subject, html: layout({ previewText: `New submission from ${opts.studioName}`, body: summary + digest }) };
}

export function changeRequestEmail(opts: { studioName: string; updateUrl: string; message: string; expiresAt: string }): { subject: string; html: string } {
  const subject = `A quick update needed for your StudioLAB Growth setup`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Hi ${escape(opts.studioName)},</h1>
    <p style="margin:0 0 14px;">Our team is reviewing your onboarding details and we need a small update before we keep going.</p>
    ${opts.message ? `<div style="background:${COL.g1};border:1px solid ${COL.g2};border-radius:10px;padding:14px 16px;margin:0 0 18px;font-size:13px;color:${COL.g8};"><strong>From our team:</strong><br>${escape(opts.message)}</div>` : ''}
    ${cta('Open the update form', opts.updateUrl)}
    <p style="margin:14px 0 0;color:${COL.g6};font-size:12px;">This link is valid until ${escape(opts.expiresAt)} and can only be used once.</p>`;
  return { subject, html: layout({ previewText: 'A quick update needed before we continue your setup.', body }) };
}

export function verificationCode(opts: { code: string; expiresInMinutes: number }): { subject: string; html: string } {
  const subject = `Your StudioLAB Growth code: ${opts.code}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Your verification code</h1>
    <p style="margin:0 0 18px;color:${COL.g6};">Enter this code on your setup form to keep going. It expires in ${opts.expiresInMinutes} minutes.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px;"><tr>
      <td align="center" bgcolor="${COL.g1}" style="background:${COL.g1};border:1px solid ${COL.g2};border-radius:10px;padding:18px;font-family:'JetBrains Mono',Menlo,monospace;font-size:30px;font-weight:800;letter-spacing:8px;color:${COL.mg};">
        ${escape(opts.code)}
      </td>
    </tr></table>
    <p style="margin:0;color:${COL.g6};font-size:12px;line-height:1.5;">If you did not request this code, you can ignore this email. Your account stays safe.</p>`;
  return { subject, html: layout({ previewText: 'Your StudioLAB Growth verification code.', body }) };
}

export function changeCompletedAdmin(opts: { studioName: string; adminUrl: string; fields: string[] }): { subject: string; html: string } {
  const subject = `${opts.studioName} has completed their change request`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Change request completed</h1>
    <p style="margin:0 0 14px;"><strong>${escape(opts.studioName)}</strong> has submitted the requested updates.</p>
    <p style="margin:0 0 18px;"><strong>Fields updated:</strong> ${opts.fields.map(escape).join(', ')}</p>
    ${cta('Review changes', opts.adminUrl)}`;
  return { subject, html: layout({ previewText: 'A studio has completed their change request.', body }) };
}

export function adminInvite(opts: {
  inviteeName: string;
  inviterName: string;
  role: string;
  adminUrl: string;
}): { subject: string; html: string } {
  const roleLabel = opts.role === 'owner' ? 'owner' : opts.role === 'va' ? 'virtual assistant' : 'admin';
  const subject = `You have been invited to StudioLAB Growth Admin`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Welcome to StudioLAB Growth Admin</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.inviteeName)},</p>
    <p style="margin:0 0 14px;"><strong>${escape(opts.inviterName)}</strong> has invited you to the StudioLAB Growth admin panel as a <strong>${escape(roleLabel)}</strong>.</p>
    <p style="margin:0 0 14px;">To sign in, visit the admin panel and enter this email address. We will send you a 6-digit code to verify it is you.</p>
    ${cta('Open the admin panel', opts.adminUrl)}
    <p style="margin:18px 0 0;color:${COL.g6};font-size:12px;line-height:1.5;">If you were not expecting this invitation, you can safely ignore this email.</p>`;
  return { subject, html: layout({ previewText: 'You have been invited to StudioLAB Growth Admin.', body }) };
}

export function handoffEmail(opts: {
  studioName: string;
  assigneeName: string;
  isRevision: boolean;
  changedFields: string[];
  plan: string;
}): { subject: string; html: string; text: string } {
  const planLabel = opts.plan === 'launch' ? 'Launch' : opts.plan === 'scale' ? 'Scale' : opts.plan === 'ai' ? 'Dominate AI' : opts.plan;
  const verb = opts.isRevision ? 'Updated handoff' : 'New handoff';
  const subject = `${verb}: ${opts.studioName} (${planLabel})`;
  const revisionBanner = opts.isRevision ? `
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;margin:0 0 16px;"><tr>
      <td style="padding:12px 14px;color:#92400E;font-size:13px;">
        <strong>This is a revised handoff.</strong> Please re-check the fields marked
        <strong>[UPDATED]</strong> in the attached document.
        ${opts.changedFields.length ? `<br><span style="font-size:12px;">Changed: ${opts.changedFields.map(escape).join(', ')}</span>` : ''}
      </td>
    </tr></table>` : '';

  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">${verb}: ${escape(opts.studioName)}</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.assigneeName)},</p>
    ${revisionBanner}
    <p style="margin:0 0 14px;">Attached is the handoff document for <strong>${escape(opts.studioName)}</strong> on the <strong>${escape(planLabel)}</strong> plan. Open it in Word or Google Docs. Each field is on its own line so you can triple-click a value and copy it straight into GHL.</p>
    <p style="margin:0 0 14px;">Section order matches the GHL implementation flow:</p>
    <ol style="margin:0 0 14px;padding-left:22px;font-size:13px;line-height:1.7;">
      <li>Account setup</li>
      <li>Primary contact</li>
      <li>Branding</li>
      <li>Email configuration</li>
      ${opts.plan === 'scale' || opts.plan === 'ai' ? '<li>SMS configuration</li>' : ''}
      ${opts.plan === 'ai' ? '<li>AI knowledge base</li>' : ''}
      <li>Notes</li>
    </ol>
    <p style="margin:0 0 14px;">When you're done, mark the assignment <strong>Completed</strong> in the admin panel.</p>
    <p style="margin:0;color:${COL.g6};font-size:12px;">If anything looks incomplete, ping back with what's missing.</p>`;
  const text = `${verb}: ${opts.studioName}\n\nAttached is the handoff document. Open in Word or Google Docs.\n${opts.isRevision ? `\nUpdated fields: ${opts.changedFields.join(', ')}\n` : ''}\nWhen done, mark the assignment Completed in the admin panel.`;
  return { subject, html: layout({ previewText: subject, body }), text };
}

// Inbox conversation notification. Used by notify-new-message. Caller passes
// the body HTML already rendered (so it can include things like the
// "internal note" banner) and a footer with the deep link.
export function inboxMessageEmail(opts: {
  studioName: string;
  senderName: string;
  bodyHtml: string;
  footerHtml: string;
  previewText: string;
}): { subject: string; html: string } {
  const body = `
    <p style="margin:0 0 10px;color:${COL.g6};font-size:12px;letter-spacing:0.4px;text-transform:uppercase;">${escape(opts.studioName)} · message thread</p>
    <p style="margin:0 0 14px;font-size:13px;color:${COL.g8};"><strong>${escape(opts.senderName)}</strong> wrote:</p>
    <div style="background:${COL.g1};border:1px solid ${COL.g2};border-radius:10px;padding:14px 16px;font-size:14px;line-height:1.55;color:${COL.g8};white-space:pre-wrap;">${opts.bodyHtml}</div>
    ${opts.footerHtml}`;
  return { subject: '', html: layout({ previewText: opts.previewText, body }) };
}

// Quote ready-for-review — sent by create-quote immediately after the
// quote is finalised. Replaces the legacy Stripe-sent quote email because
// Stripe removed POST /v1/quotes/{id}/send. The link points to our own
// hosted quote page (quote.html), authenticated by a URL token written
// to quotes.token at issue time.
export function quoteReadyForReview(opts: {
  recipientName: string;
  studioContext?: string | null;     // e.g. "StudioLAB Growth team" — appears in the body
  quoteNumber: string;
  amountDisplay: string;             // pre-formatted, e.g. "AUD $7,150.00 incl. GST"
  expiresAtIso: string;              // ISO date for "valid until X" line
  coverNote?: string | null;         // admin-set scope note, shown verbatim
  acceptUrl: string;                 // quote.html?q=…&t=…
}): { subject: string; html: string } {
  const subject = `Your quote from StudioLAB: ${opts.quoteNumber}`;
  const expiresDisplay = (() => {
    try { return new Date(opts.expiresAtIso).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch (_) { return opts.expiresAtIso; }
  })();
  const noteBlock = opts.coverNote && opts.coverNote.trim()
    ? `<div style="background:${COL.g1};border:1px solid ${COL.g2};border-radius:10px;padding:14px 16px;margin:0 0 18px;font-size:14px;line-height:1.55;white-space:pre-wrap;">${escape(opts.coverNote.trim())}</div>`
    : '';
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Your quote is ready</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.recipientName)},</p>
    <p style="margin:0 0 14px;">Quote <strong>${escape(opts.quoteNumber)}</strong> for <strong>${escape(opts.amountDisplay)}</strong> is ready for you to review.</p>
    ${noteBlock}
    <p style="margin:0 0 14px;">Open the link below to view the full breakdown, download the PDF, and accept or decline.</p>
    ${cta('Review and accept your quote', opts.acceptUrl)}
    <p style="margin:0 0 6px;color:${COL.g6};font-size:11px;line-height:1.5;">If the button does not work in your email client, copy this link into your browser:</p>
    <p style="margin:0 0 18px;font-size:12px;line-height:1.45;word-break:break-all;"><a href="${escape(opts.acceptUrl)}" target="_blank" rel="noopener noreferrer" style="color:${COL.in};text-decoration:underline;">${escape(opts.acceptUrl)}</a></p>
    <p style="margin:14px 0 0;color:${COL.g6};font-size:12px;">This quote is valid until ${escape(expiresDisplay)}. Reply to this email if you have any questions.</p>`;
  return { subject, html: layout({ previewText: `Quote ${opts.quoteNumber} for ${opts.amountDisplay} is ready for review.`, body }) };
}

// Quote nudge — sent 7 days after the quote was issued if the recipient
// hasn't accepted or declined. Soft tone; no scarcity. The quote's hosted
// link comes from the Stripe-sent quote email, so we point the recipient
// back to that email rather than rebuilding the link ourselves.
export function quoteReminderNudge(opts: {
  recipientName: string;
  quoteNumber: string;
  amountDisplay: string;        // pre-formatted, e.g. "AUD $1,650.00 incl. GST"
  expiresInDays: number;
}): { subject: string; html: string } {
  const subject = `Following up on your StudioLAB quote ${opts.quoteNumber}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Just checking in</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.recipientName)},</p>
    <p style="margin:0 0 14px;">A quick follow-up on quote <strong>${escape(opts.quoteNumber)}</strong> for <strong>${escape(opts.amountDisplay)}</strong>. It's still open for the next ${opts.expiresInDays} day${opts.expiresInDays === 1 ? '' : 's'}.</p>
    <p style="margin:0 0 14px;">If you have any questions about the scope, timing, or what's included, just reply to this email and we'll talk it through. Otherwise, you can accept directly from the original quote email. Accepting turns the quote into an invoice you can pay straight away.</p>
    <p style="margin:0 0 14px;">No pressure either way.</p>
    <p style="margin:0;">The StudioLAB team</p>`;
  return { subject, html: layout({ previewText: `Quote ${opts.quoteNumber} is still open. Let us know if you need anything.`, body }) };
}

// Expiry warning — sent 5 days before expires_at as a final heads-up.
export function quoteExpiryWarning(opts: {
  recipientName: string;
  quoteNumber: string;
  amountDisplay: string;
  expiresInDays: number;        // typically 5; we pass through what the cron calculates
}): { subject: string; html: string } {
  const dayWord = opts.expiresInDays === 1 ? 'tomorrow' : `in ${opts.expiresInDays} days`;
  const headlineWord = opts.expiresInDays === 1 ? 'tomorrow' : `in ${opts.expiresInDays} days`;
  const subject = `Quote ${opts.quoteNumber} expires ${dayWord}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Your quote closes ${escape(headlineWord)}</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.recipientName)},</p>
    <p style="margin:0 0 14px;">Quote <strong>${escape(opts.quoteNumber)}</strong> for <strong>${escape(opts.amountDisplay)}</strong> closes ${escape(dayWord)}. After that the pricing and scope on it will lapse, and we'd need to issue a fresh quote if you want to come back to it.</p>
    <p style="margin:0 0 14px;">If you're keen to go ahead, you can accept directly from the original quote email. If you'd rather pause or have questions, just reply and we'll work it out.</p>
    <p style="margin:0;">The StudioLAB team</p>`;
  return { subject, html: layout({ previewText: `Quote ${opts.quoteNumber} expires ${dayWord}.`, body }) };
}

export function kbAbandonmentNudge(opts: { studioName: string; resumeUrl: string }): { subject: string; html: string } {
  const subject = `Your AI is almost ready, ${opts.studioName}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Just one step left</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.studioName)},</p>
    <p style="margin:0 0 14px;">Your payment is sorted and we have already pulled the content from your website into your AI knowledge base. The last thing we need from you is a quick five-minute review so your assistant sounds exactly like your studio.</p>
    <p style="margin:0 0 14px;">Once you confirm the knowledge base, our team can finish wiring up your AI chat and voice assistant. Until then, we have hit pause on the build.</p>
    ${cta('Finish my knowledge base', opts.resumeUrl)}
    <p style="margin:14px 0 0;color:${COL.g6};font-size:12px;">If you have already finished this and are still seeing reminders, please ignore this email and we will sort it on our end.</p>`;
  return { subject, html: layout({ previewText: 'Your AI knowledge base is waiting on a final five-minute review.', body }) };
}

// ---------------------------------------------------------------------------
// Deliverable lifecycle emails (Phase 6.4). One template per state move
// surfaced to a human:
//   * submitted_for_review → client (recipient)
//   * revisions_requested  → admin / team
//   * approved             → admin / team
// All called from manage-deliverable / portal-project, gated on stripe_mode
// in test (per project_email_gating_test_mode memory).
// ---------------------------------------------------------------------------

export function deliverableSubmittedForReview(opts: {
  recipientName: string;
  projectName: string;
  deliverableTitle: string;
  description?: string | null;
  dueDate?: string | null;
  projectUrl: string;
}): { subject: string; html: string } {
  const subject = `Ready for your review: ${opts.deliverableTitle}`;
  const dueLine = opts.dueDate
    ? `<p style="margin:0 0 14px;color:${COL.g6};font-size:13px;">Due ${escape(opts.dueDate)}.</p>`
    : '';
  const descBlock = opts.description
    ? `<p style="margin:0 0 14px;white-space:pre-wrap;">${escape(opts.description)}</p>`
    : '';
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Ready for your review</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.recipientName)},</p>
    <p style="margin:0 0 14px;">We've just submitted a deliverable on your <strong>${escape(opts.projectName)}</strong> project for you to look over.</p>
    <p style="margin:0 0 6px;color:${COL.g6};font-size:12px;">Deliverable</p>
    <p style="margin:0 0 14px;font-weight:600;font-size:16px;color:${COL.in_d};">${escape(opts.deliverableTitle)}</p>
    ${descBlock}
    ${dueLine}
    <p style="margin:0 0 14px;">Open your project page to approve it or request revisions:</p>
    ${cta('Review on your project page', opts.projectUrl)}
    <p style="margin:14px 0 0;color:${COL.g6};font-size:12px;">If you have questions, reply to this email and it goes straight to the team.</p>`;
  return { subject, html: layout({ previewText: `${opts.deliverableTitle} is ready for your review on ${opts.projectName}.`, body }) };
}

export function deliverableRevisionsRequestedAdmin(opts: {
  recipientName: string;
  projectName: string;
  deliverableTitle: string;
  notes: string;
  adminUrl: string;
}): { subject: string; html: string } {
  const subject = `Revisions requested: ${opts.deliverableTitle}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Revisions requested</h1>
    <p style="margin:0 0 14px;"><strong>${escape(opts.recipientName)}</strong> has asked for revisions on a deliverable in <strong>${escape(opts.projectName)}</strong>.</p>
    <p style="margin:0 0 6px;color:${COL.g6};font-size:12px;">Deliverable</p>
    <p style="margin:0 0 14px;font-weight:600;font-size:16px;color:${COL.in_d};">${escape(opts.deliverableTitle)}</p>
    <p style="margin:0 0 6px;color:${COL.g6};font-size:12px;">What they said</p>
    <div style="margin:0 0 18px;padding:14px 16px;background:${COL.g1};border-left:3px solid ${COL.in};border-radius:6px;white-space:pre-wrap;font-size:14px;">${escape(opts.notes)}</div>
    ${cta('Open project in admin', opts.adminUrl)}`;
  return { subject, html: layout({ previewText: `${opts.recipientName} requested revisions on ${opts.deliverableTitle}.`, body }) };
}

export function deliverableApprovedAdmin(opts: {
  recipientName: string;
  projectName: string;
  deliverableTitle: string;
  adminUrl: string;
}): { subject: string; html: string } {
  const subject = `Approved: ${opts.deliverableTitle}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Deliverable approved</h1>
    <p style="margin:0 0 14px;"><strong>${escape(opts.recipientName)}</strong> just approved <strong>${escape(opts.deliverableTitle)}</strong> on <strong>${escape(opts.projectName)}</strong>.</p>
    <p style="margin:0 0 14px;">No action required. This is a heads-up so you can mark it delivered when you ship the final asset.</p>
    ${cta('Open project in admin', opts.adminUrl)}`;
  return { subject, html: layout({ previewText: `${opts.recipientName} approved ${opts.deliverableTitle}.`, body }) };
}

// ---------------------------------------------------------------------------
// Admin notification - daily digest of quotes the cron auto-cancelled at
// expiry. Sent once per cron run when one or more quotes lapsed, so admins
// can decide whether to follow up with the recipient or let it go.
// ---------------------------------------------------------------------------
export interface AutoCancelDigestRow {
  number: string | null;
  recipientLabel: string;        // studio name or external contact email
  amountDisplay: string;         // pre-formatted, e.g. "AUD $1,650.00 incl. GST"
  expiresAt: string | null;      // ISO; rendered as a date
}
export function quoteAutoCancelDigest(opts: {
  rows: AutoCancelDigestRow[];
  adminUrl: string;
}): { subject: string; html: string } {
  const n = opts.rows.length;
  const subject = `${n} quote${n === 1 ? '' : 's'} auto-cancelled at expiry`;
  const tableRows = opts.rows.map((r) => `
    <tr>
      <td style="padding:8px 12px 8px 0;vertical-align:top;color:${COL.in_d};font-weight:600;">${escape(r.number || '(unnumbered)')}</td>
      <td style="padding:8px 12px 8px 0;vertical-align:top;color:${COL.g8};">${escape(r.recipientLabel)}</td>
      <td style="padding:8px 12px 8px 0;vertical-align:top;color:${COL.g8};">${escape(r.amountDisplay)}</td>
      <td style="padding:8px 0;vertical-align:top;color:${COL.g6};font-size:12px;">${r.expiresAt ? escape(new Date(r.expiresAt).toLocaleDateString('en-AU')) : '-'}</td>
    </tr>
  `).join('');
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Auto-cancelled quotes</h1>
    <p style="margin:0 0 14px;">The daily quote sweep cancelled ${n} quote${n === 1 ? '' : 's'} that reached their expiry without being accepted or declined.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 18px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:6px 12px 6px 0;color:${COL.g6};font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;border-bottom:1px solid ${COL.g2};">Number</th>
          <th style="text-align:left;padding:6px 12px 6px 0;color:${COL.g6};font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;border-bottom:1px solid ${COL.g2};">Recipient</th>
          <th style="text-align:left;padding:6px 12px 6px 0;color:${COL.g6};font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;border-bottom:1px solid ${COL.g2};">Amount</th>
          <th style="text-align:left;padding:6px 0;color:${COL.g6};font-size:11px;text-transform:uppercase;letter-spacing:0.4px;font-weight:600;border-bottom:1px solid ${COL.g2};">Expired</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
    <p style="margin:0 0 14px;color:${COL.g6};font-size:13px;">No action required. Open admin to revisit any of these (re-issue, re-quote, or just close out).</p>
    ${cta('Open Quotes in admin', opts.adminUrl)}`;
  return { subject, html: layout({ previewText: `${n} quote${n === 1 ? '' : 's'} reached expiry today and were auto-cancelled.`, body }) };
}

// ---------------------------------------------------------------------------
// Admin notification - a Stripe quote was canceled in the Stripe dashboard
// (or some other path outside our cancel-quote function) for which we have
// no ledger row. Surfaces the orphan to admins so they can decide whether
// to follow up or ignore - previously this went to console.log only.
// ---------------------------------------------------------------------------
export function adminQuoteCanceledOrphan(opts: {
  stripeQuoteId: string;
  number: string | null;
  recipientHint?: string | null;
  adminUrl: string;
}): { subject: string; html: string } {
  const label = opts.number || opts.stripeQuoteId;
  const subject = `Orphan quote cancel: ${label}`;
  const recipientLine = opts.recipientHint
    ? `<p style="margin:0 0 6px;"><strong>Recipient hint:</strong> ${escape(opts.recipientHint)}</p>`
    : '';
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Orphan quote cancellation</h1>
    <p style="margin:0 0 14px;">Stripe reported a <strong>quote.canceled</strong> event for a quote we have no ledger row for. This usually means someone cancelled it directly in the Stripe dashboard, or the original quote was created outside StudioLAB Growth.</p>
    <p style="margin:0 0 6px;"><strong>Stripe quote id:</strong> <code style="background:${COL.g1};padding:2px 6px;border-radius:4px;">${escape(opts.stripeQuoteId)}</code></p>
    <p style="margin:0 0 6px;"><strong>Number:</strong> ${escape(label)}</p>
    ${recipientLine}
    <p style="margin:14px 0;color:${COL.g6};font-size:13px;">No action required from us. If you cancelled this on purpose, ignore the email. If not, the Stripe dashboard has the full event timeline.</p>
    ${cta('Open Quotes in admin', opts.adminUrl)}`;
  return { subject, html: layout({ previewText: `Stripe reported a quote.canceled for ${label} but we have no ledger row for it.`, body }) };
}

// ---------------------------------------------------------------------------
// Admin notification — Stripe reported invoice.payment_failed. Stripe will
// retry on its own schedule and the recipient gets Stripe's own dunning
// email, but we surface the event to admins so a VA can decide whether to
// follow up (e.g. confirm card details, reissue a quote, etc.).
// ---------------------------------------------------------------------------
export function adminInvoicePaymentFailed(opts: {
  recipientLabel: string;        // studio name or external contact name
  invoiceNumber: string | null;
  amountCents: number | null;
  currency: string;
  reason?: string | null;        // optional decline reason from Stripe
  hostedInvoiceUrl?: string | null;
  adminUrl: string;
}): { subject: string; html: string } {
  const amountDisplay = (opts.amountCents != null)
    ? `${opts.currency.toUpperCase()} $${(opts.amountCents / 100).toFixed(2)}`
    : '—';
  const invoiceLabel = opts.invoiceNumber || '(unnumbered)';
  const subject = `Payment failed: ${invoiceLabel} for ${opts.recipientLabel}`;
  const reasonBlock = opts.reason
    ? `<p style="margin:0 0 6px;color:${COL.g6};font-size:12px;">Stripe reported</p>
       <div style="margin:0 0 18px;padding:14px 16px;background:${COL.g1};border-left:3px solid ${COL.in};border-radius:6px;white-space:pre-wrap;font-size:14px;">${escape(opts.reason)}</div>`
    : '';
  const stripeLink = opts.hostedInvoiceUrl
    ? `<p style="margin:0 0 14px;font-size:13px;"><a href="${escape(opts.hostedInvoiceUrl)}" style="color:${COL.in};">Open hosted invoice on Stripe →</a></p>`
    : '';
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Payment failed</h1>
    <p style="margin:0 0 14px;">Stripe reported a failed payment attempt on an invoice for <strong>${escape(opts.recipientLabel)}</strong>.</p>
    <p style="margin:0 0 6px;color:${COL.g6};font-size:12px;">Invoice</p>
    <p style="margin:0 0 14px;font-weight:600;font-size:16px;color:${COL.in_d};">${escape(invoiceLabel)} · ${escape(amountDisplay)}</p>
    ${reasonBlock}
    <p style="margin:0 0 14px;">Stripe will retry automatically and emails the recipient its own dunning notice. Open the invoice if you want to chase the customer, edit the invoice, or void and reissue.</p>
    ${cta('Open invoice in admin', opts.adminUrl)}
    ${stripeLink}
    <p style="margin:14px 0 0;color:${COL.g6};font-size:12px;">No action required from the recipient. This is a heads-up so the team can follow up if needed.</p>`;
  return { subject, html: layout({ previewText: `Stripe reported payment_failed on ${invoiceLabel} for ${opts.recipientLabel}.`, body }) };
}

function escape(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string));
}
