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
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>
    <td style="background:${COL.in};border-radius:999px;">
      <a href="${url}" style="display:inline-block;padding:12px 24px;color:#fff;text-decoration:none;font-weight:600;font-size:14px;">${escape(label)}</a>
    </td></tr></table>`;
}

export function submissionConfirmation(opts: { studioName: string; ref: string }): { subject: string; html: string } {
  const subject = `We have your StudioLAB Growth details, ${opts.studioName}`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">Thanks, we have everything we need</h1>
    <p style="margin:0 0 14px;">Hi from the StudioLAB Growth team. Your onboarding details have come through and we are getting started.</p>
    <p style="margin:0 0 14px;">A team member will review what you sent and reach out shortly to confirm next steps. If anything is missing, we will send you a quick link to add it without filling out the whole form again.</p>
    <p style="margin:0 0 6px;color:${COL.g6};font-size:12px;">Your reference</p>
    <p style="margin:0 0 18px;font-family:'JetBrains Mono',Menlo,monospace;font-size:14px;color:${COL.in_d};font-weight:700;">${escape(opts.ref)}</p>
    <p style="margin:0;">Speak soon,<br>The StudioLAB Growth team</p>`;
  return { subject, html: layout({ previewText: 'We have your StudioLAB Growth onboarding details.', body }) };
}

export function adminNewSubmission(opts: { studioName: string; plan: string; setup: string; adminUrl: string }): { subject: string; html: string } {
  const subject = `New Growth onboarding: ${opts.studioName} (${opts.plan})`;
  const body = `
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">New onboarding submission</h1>
    <p style="margin:0 0 6px;"><strong>Studio:</strong> ${escape(opts.studioName)}</p>
    <p style="margin:0 0 6px;"><strong>Plan:</strong> ${escape(opts.plan)}</p>
    <p style="margin:0 0 18px;"><strong>Setup:</strong> ${escape(opts.setup)}</p>
    ${cta('Open in dashboard', opts.adminUrl)}`;
  return { subject, html: layout({ previewText: `New submission from ${opts.studioName}`, body }) };
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
    <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:${COL.in_d};letter-spacing:-0.3px;">${verb} — ${escape(opts.studioName)}</h1>
    <p style="margin:0 0 14px;">Hi ${escape(opts.assigneeName)},</p>
    ${revisionBanner}
    <p style="margin:0 0 14px;">Attached is the handoff document for <strong>${escape(opts.studioName)}</strong> on the <strong>${escape(planLabel)}</strong> plan. Open it in Word or Google Docs — each field is on its own line so you can triple-click a value and copy it straight into GHL.</p>
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
  const text = `${verb} — ${opts.studioName}\n\nAttached is the handoff document. Open in Word or Google Docs.\n${opts.isRevision ? `\nUpdated fields: ${opts.changedFields.join(', ')}\n` : ''}\nWhen done, mark the assignment Completed in the admin panel.`;
  return { subject, html: layout({ previewText: subject, body }), text };
}

function escape(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string));
}
