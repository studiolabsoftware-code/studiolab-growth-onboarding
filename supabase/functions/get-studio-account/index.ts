// Studio account view — used by /account.html post-payment to render the
// studio's submission summary, status, invoices, and a portal-thread link.
// Auth: studio's session_token in localStorage (same anchor used by
// save-draft / get-kb-status). Anon-callable (deployed --no-verify-jwt).

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { ensureConversationForSubmission, ensureStudioToken } from '../_shared/inbox.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const body = await req.json().catch(() => ({}));
    const sessionToken = typeof body.session_token === 'string' ? body.session_token : '';
    if (!sessionToken) return jsonResponse({ ok: false, error: 'Missing session token.' }, 401);

    const sb = adminClient();
    const sessionHash = await sha256Hex(sessionToken);

    const { data: submission, error: subErr } = await sb.from('submissions')
      .select(
        'id, plan, region, setup_type, status, ' +
        'studio_name, contact_email, first_name, last_name, country, timezone, ' +
        'payment_status, paid_at, captured_at, card_saved_at, ' +
        'amount_paid_cents, currency, tax_amount_cents, ' +
        'invoice_hosted_url, invoice_pdf_url, ' +
        'submitted_at, last_saved_at, session_expires_at, activated_at, ' +
        'kb_completed_at, ' +
        'email_notifications_enabled, unsubscribe_token, ' +
        // Self-edit surface — the additional fields below are read back so
        // the studio sees its current values when entering edit mode.
        'first_name, last_name, role, contact_phone, address, website, ' +
        'support_url, studio_description, primary_colour, secondary_colour, ' +
        'sign_off, email_tone, footer_notes, from_name, reply_email, ' +
        'custom_domain, instagram_handle, facebook_url, google_business_url, ' +
        'tiktok_handle, youtube_url, booking_url, brand_reference_url, extra_notes',
      )
      .eq('session_token_hash', sessionHash)
      .maybeSingle();
    if (subErr) throw subErr;
    if (!submission) return jsonResponse({ ok: false, error: 'Session not found.' }, 401);
    if (!submission.session_expires_at || new Date(submission.session_expires_at) < new Date()) {
      return jsonResponse({ ok: false, error: 'Session expired.' }, 401);
    }

    // Invoice ledger — every Stripe document we have for this submission.
    // Sorted newest-first so the most recent receipt sits at the top.
    const { data: invoices } = await sb.from('invoices')
      .select('id, number, kind, status, currency, total_cents, tax_cents, amount_paid_cents, amount_refunded_cents, issued_at, paid_at, due_at, hosted_url, pdf_url, description')
      .eq('submission_id', submission.id)
      .order('issued_at', { ascending: false, nullsFirst: false });

    // Quotes ledger — surfaced separately from invoices so the studio can
    // see pending offers and their expiry. Accepted quotes also produce an
    // invoice (kind='quote_invoice') which appears in the invoices array
    // above; the two sections are deliberately complementary.
    const { data: quotes } = await sb.from('quotes')
      .select('id, number, status, acceptance_mode, currency, total_cents, expires_at, sent_at, accepted_at, hosted_url, pdf_url, cover_note')
      .eq('submission_id', submission.id)
      .order('sent_at', { ascending: false, nullsFirst: false });

    // Service requests ledger — structured change asks (plan upgrade,
    // setup switch, custom add-on, other). Newest first so the most
    // recent request reads at the top of the studio's history list.
    const { data: serviceRequests } = await sb.from('service_requests')
      .select('id, kind, target_plan, target_setup_type, notes, status, quote_id, declined_reason, created_at, applied_at')
      .eq('submission_id', submission.id)
      .order('created_at', { ascending: false });

    // Conversation + studio_token for the inline Messages composer on
    // account.html. Both must exist before the page renders so the studio
    // can send their first message without waiting for an admin to seed
    // anything. ensureConversationForSubmission is idempotent (returns the
    // existing conversation id if one is already on the row), and
    // ensureStudioToken mints a token only when none is set.
    const conversationId = await ensureConversationForSubmission(
      sb,
      submission.id,
      submission.studio_name,
    );
    const studioToken = await ensureStudioToken(sb, conversationId);

    const { data: conversation } = await sb.from('conversations')
      .select('id, studio_unread_count')
      .eq('id', conversationId)
      .maybeSingle();

    const portalUrl = `/portal.html?conv=${conversationId}&t=${encodeURIComponent(studioToken)}`;

    return jsonResponse({
      ok: true,
      submission: {
        id: submission.id,
        plan: submission.plan,
        region: submission.region,
        setup_type: submission.setup_type,
        status: submission.status,
        studio_name: submission.studio_name,
        contact_email: submission.contact_email,
        first_name: submission.first_name,
        last_name: submission.last_name,
        country: submission.country,
        timezone: submission.timezone,
        payment_status: submission.payment_status,
        paid_at: submission.paid_at,
        captured_at: submission.captured_at,
        card_saved_at: submission.card_saved_at,
        amount_paid_cents: submission.amount_paid_cents,
        currency: submission.currency,
        tax_amount_cents: submission.tax_amount_cents,
        invoice_hosted_url: submission.invoice_hosted_url,
        invoice_pdf_url: submission.invoice_pdf_url,
        submitted_at: submission.submitted_at,
        activated_at: submission.activated_at,
        kb_completed_at: submission.kb_completed_at,
        email_notifications_enabled: submission.email_notifications_enabled !== false,
        unsubscribe_token: submission.unsubscribe_token,
        // Self-edit surface
        role: submission.role,
        contact_phone: submission.contact_phone,
        address: submission.address,
        website: submission.website,
        support_url: submission.support_url,
        studio_description: submission.studio_description,
        primary_colour: submission.primary_colour,
        secondary_colour: submission.secondary_colour,
        sign_off: submission.sign_off,
        email_tone: submission.email_tone,
        footer_notes: submission.footer_notes,
        from_name: submission.from_name,
        reply_email: submission.reply_email,
        custom_domain: submission.custom_domain,
        instagram_handle: submission.instagram_handle,
        facebook_url: submission.facebook_url,
        google_business_url: submission.google_business_url,
        tiktok_handle: submission.tiktok_handle,
        youtube_url: submission.youtube_url,
        booking_url: submission.booking_url,
        brand_reference_url: submission.brand_reference_url,
        extra_notes: submission.extra_notes,
      },
      invoices: invoices || [],
      quotes: quotes || [],
      service_requests: serviceRequests || [],
      conversation: {
        id: conversationId,
        token: studioToken,
        unread: conversation?.studio_unread_count || 0,
        portal_url: portalUrl,
      },
    });
  } catch (err) {
    console.error('get-studio-account error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
