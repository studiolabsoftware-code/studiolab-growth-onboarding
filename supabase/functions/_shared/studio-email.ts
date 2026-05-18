// Studio-side email opt-out helper. Sits one level above
// createGatedSender (which handles live/test mode + test redirect) and
// adds the legal-compliance layer: an essential-vs-optional intent
// classifier plus per-studio opt-out enforcement, plus a stable
// unsubscribe URL the templates embed in the footer.
//
// Two tiers:
//
//   ESSENTIAL -- always sent regardless of opt-out. Covers everything
//   that is genuinely transactional under spam law: security (OTP,
//   magic links), financial records (payment receipts, refunds),
//   significant state changes (account activation), and direct
//   responses to a studio's explicit action (quote ready, request
//   applied / declined). Spam law exempts these from unsubscribe
//   requirements anyway, but the link still lands in the footer.
//
//   OPTIONAL -- respects email_notifications_enabled. Inbox message
//   notifications, KB abandonment nudges, quote reminders, quote
//   expiry warnings. These are the marketing-adjacent ones the law
//   actually cares about.
//
// Use:
//
//   const url = unsubscribeUrl(submission.unsubscribe_token);
//   const tpl = paymentReceiptImmediate({...fields, unsubscribeUrl: url});
//   await sendIfAllowed({
//     sb, submissionId, intent: 'studio receipt (immediate)',
//     sender: sendGated, to: studioEmail,
//     subject: tpl.subject, html: tpl.html,
//   });

// deno-lint-ignore no-explicit-any
type Sb = any;

import type { GatedSender, GatedEmail } from './email-gated.ts';

// Hard-coded essential intents. Keep this list in sync with the
// intent strings actually used at call sites -- grep for `intent:` in
// supabase/functions to confirm coverage.
const ESSENTIAL_INTENTS = new Set([
  'studio submission confirmation',
  'studio receipt (immediate)',
  'studio receipt (hold)',
  'studio receipt (save card)',
  'studio activated',
  'studio request quoted',
  'studio request applied',
  'studio request declined',
  'quote ready for review',
  // Security / auth -- these usually bypass the gated sender entirely
  // (send-otp, send-change-request use sendEmail directly) but include
  // them here so the classifier is complete and self-documenting.
  'verification code',
  'change request magic link',
]);

export function isEssential(intent: string): boolean {
  return ESSENTIAL_INTENTS.has(intent);
}

// Public base URL for the unsubscribe page. APP_URL is the same env
// var the rest of the system uses for outbound links.
export function unsubscribeUrl(token: string | null | undefined): string | null {
  if (!token) return null;
  const appUrl = (Deno.env.get('APP_URL') || '').replace(/\/+$/, '');
  if (!appUrl) return null;
  return `${appUrl}/unsubscribe.html?t=${encodeURIComponent(token)}`;
}

/**
 * Look up a studio's current opt-out preference + unsubscribe token by
 * submission id. Returns null if the submission is not found.
 */
export async function loadStudioEmailPrefs(
  sb: Sb,
  submissionId: string,
): Promise<{ enabled: boolean; token: string | null } | null> {
  const { data } = await sb.from('submissions')
    .select('email_notifications_enabled, unsubscribe_token')
    .eq('id', submissionId)
    .maybeSingle();
  if (!data) return null;
  return {
    enabled: data.email_notifications_enabled !== false,
    token: data.unsubscribe_token || null,
  };
}

/**
 * Inject a small "Unsubscribe" link before the closing </body> tag.
 * Wrapper approach avoids having to thread unsubscribeUrl through
 * every template factory's signature -- the existing layout's footer
 * stays untouched, this just appends a discreet legal-compliance row
 * under it.
 *
 * Exported so paths that send via sendEmail directly (notify-new-message,
 * nudge-abandoned-kb, quote-reminders use mailgun.ts directly with
 * custom headers and bypass the gated sender) can inject the footer
 * without going through sendIfAllowed.
 */
export function injectUnsubscribeFooter(html: string, url: string): string {
  const link = `<div style="text-align:center;padding:8px 16px 20px;font-size:11px;color:#9CA3AF;font-family:Arial,sans-serif;">` +
    `You are receiving this because you set up a StudioLAB Growth account. ` +
    `<a href="${escapeAttr(url)}" style="color:#9CA3AF;text-decoration:underline;">Unsubscribe from optional notifications</a>.` +
    `</div>`;
  // Robust against missing </body>: fall back to appending at end.
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, link + '</body>');
  }
  return html + link;
}

function escapeAttr(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] as string));
}

/**
 * Send an email to a studio, honouring opt-out for optional intents
 * and auto-injecting the unsubscribe footer.
 *
 *   * Essential intent → always send. Unsub link still lands in the
 *     footer for compliance, but the flag doesn't gate delivery.
 *   * Optional intent → skip with a log line if the studio has opted
 *     out. Otherwise send normally with footer injected.
 *
 * If submissionId is null/undefined, the helper passes through to the
 * sender as-is (no footer, no opt-out check) -- safe default for paths
 * that legitimately have no studio context.
 *
 * Returns true when the email was actually sent, false when it was
 * skipped (so callers can decide whether to log skipped sends).
 */
export async function sendIfAllowed(opts: {
  sb: Sb;
  submissionId: string | null | undefined;
  sender: GatedSender;
  email: GatedEmail;
}): Promise<boolean> {
  const intent = opts.email.intent;
  const essential = isEssential(intent);

  if (!opts.submissionId) {
    await opts.sender(opts.email);
    return true;
  }

  const prefs = await loadStudioEmailPrefs(opts.sb, opts.submissionId);
  if (!prefs) {
    // Submission gone; nothing to send to.
    return false;
  }
  if (!essential && !prefs.enabled) {
    console.log(`studio-email: skipping ${intent} for submission ${opts.submissionId} — opted out`);
    return false;
  }

  const url = unsubscribeUrl(prefs.token);
  const html = url ? injectUnsubscribeFooter(opts.email.html, url) : opts.email.html;
  await opts.sender({ ...opts.email, html });
  return true;
}
