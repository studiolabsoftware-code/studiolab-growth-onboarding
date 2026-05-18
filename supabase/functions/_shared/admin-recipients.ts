// Centralised admin notification recipient list. Read by every server
// path that emails the admin team (new submission, payment landed,
// payment failed, change request completed, new inbox message, project
// deliverable revisions, auto-cancel digest, orphan quote cancel).
//
// Rule (intentional asymmetry between modes):
//   * live mode  -> every active admin gets the email (owners + VAs + admins)
//   * test mode  -> owner-only. Keeps VA inboxes clean during smoke tests
//                   and sandbox flows where the trigger is intentional but
//                   not customer-facing. Pairs with the existing
//                   STRIPE_TEST_EMAIL_RECIPIENT redirect in createGatedSender:
//                   the recipient list is filtered first, then the gated
//                   sender optionally re-routes the whole message to the
//                   single test inbox.
//
// Returns deduped email strings, lowercased. Callers should treat an
// empty list as "no one to notify" (don't try to send to []), so the
// `if (recipients.length === 0) return;` early-out is the standard
// caller pattern.

// deno-lint-ignore no-explicit-any
type Sb = any;

export async function resolveAdminNotificationRecipients(
  sb: Sb,
  isLive: boolean,
): Promise<string[]> {
  // Two filters always: active AND opted in to email notifications.
  // Migration 038 introduced email_notifications_enabled with a default
  // of true, so existing rows keep receiving emails. An admin who has
  // explicitly toggled off (via the Users page) drops out of every
  // notification path that reads through this helper.
  const q = sb.from('admin_users')
    .select('email, role')
    .eq('is_active', true)
    .eq('email_notifications_enabled', true);
  // In test mode, restrict to owners. The role check happens server-side
  // (RLS-safe; we use the service-role client). If a project has zero
  // owners (shouldn't happen — migration 001 seeds the founder as owner),
  // the list comes back empty and the caller skips.
  if (!isLive) q.eq('role', 'owner');
  const { data, error } = await q;
  if (error) throw error;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of (data || [])) {
    const e = String((row as { email?: string }).email || '').trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}
