// Test-mode-gated email send. Centralises the rule documented in the
// `project_email_gating_test_mode` memory: while Stripe is in test mode, any
// side-effect email must redirect to STRIPE_TEST_EMAIL_RECIPIENT (when set)
// or fall through to the real recipient (when unset, paired with Gmail
// alias addresses). Live mode always sends to the real recipient.
//
// Two helpers:
//   * createGatedSender(opts) — preferred when a single request fires many
//     emails: resolves isLive + testRecipient once, returns a closure.
//   * sendGatedOnce(sb, args)  — convenience for one-off sends (e.g. a
//     webhook branch that only sends one email per event).
//
// Both treat send failures as fire-and-forget: callers wrap in try/catch
// and log — never let an email send tank the webhook or admin action.

import { sendEmail } from './mailgun.ts';

// deno-lint-ignore no-explicit-any
type Sb = any;

export interface GatedEmail {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  /**
   * Short label used in the `[TEST · <intent>]` subject prefix when the
   * gate routes a message to the test inbox. Useful for filtering inside
   * a shared QA mailbox.
   */
  intent: string;
}

export interface GatedSenderOptions {
  isLive: boolean;
  /**
   * When set, all non-live sends are routed to this address (subject
   * prefixed with `[TEST · …]`). When empty/undefined in test mode, the
   * message is delivered to its real recipient — pair with Gmail aliases
   * like `name+test@gmail.com` to exercise the full Mailgun flow.
   */
  testRecipient?: string | null;
}

export type GatedSender = (g: GatedEmail) => Promise<void>;

export function createGatedSender(opts: GatedSenderOptions): GatedSender {
  const isLive = !!opts.isLive;
  const testRecipient = (opts.testRecipient || '').trim();
  return async function sendGated(g: GatedEmail): Promise<void> {
    if (isLive) {
      await sendEmail({ to: g.to, subject: g.subject, html: g.html, replyTo: g.replyTo });
      return;
    }
    if (testRecipient) {
      await sendEmail({
        to: testRecipient,
        subject: `[TEST · ${g.intent}] ${g.subject}`,
        html: g.html,
        replyTo: g.replyTo,
      });
      return;
    }
    await sendEmail({ to: g.to, subject: g.subject, html: g.html, replyTo: g.replyTo });
  };
}

/**
 * Resolve isLive + testRecipient from the DB + env, then send a single
 * gated email. Prefer createGatedSender() if you'll send more than one
 * message per request — this helper hits the DB on every call.
 */
export async function sendGatedOnce(sb: Sb, g: GatedEmail): Promise<void> {
  const { data: settings } = await sb.from('payment_settings').select('stripe_mode').eq('id', 1).maybeSingle();
  const isLive = (settings?.stripe_mode || 'test') === 'live';
  const testRecipient = Deno.env.get('STRIPE_TEST_EMAIL_RECIPIENT') || '';
  const sender = createGatedSender({ isLive, testRecipient });
  await sender(g);
}
