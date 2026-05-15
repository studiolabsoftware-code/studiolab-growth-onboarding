// Quote PDF proxy. Stripe's GET /v1/quotes/{id}/pdf requires API auth and
// returns the PDF body — there is no public hosted URL on the Quote object.
// This function authenticates the caller, verifies they own the quote, and
// streams the PDF back so admins + studios can download a copy without ever
// seeing our Stripe API key.
//
// Two auth modes:
//   1. Admin caller via Supabase JWT (Authorization: Bearer <jwt>)
//   2. Studio caller via session_token (the same anchor save-draft and
//      get-studio-account use). Studio mode requires the quote's
//      submission_id to match the session's submission.
//
// Accepts POST { quote_id, session_token? }. The frontend always fetches
// with POST, reads the response as a Blob, and triggers the download with a
// JS-built ObjectURL — this keeps the session_token off the URL bar /
// browser history / server logs and applies the same flow to admin + studio
// callers.

import { corsHeaders, preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient, sha256Hex } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { getStripeKey, getStripeMode } from '../_shared/stripe.ts';

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'POST required.' }, 405);
    }
    const body = await req.json().catch(() => ({})) as { quote_id?: string; session_token?: string };
    const quoteIdInput = (body.quote_id || '').trim();
    const sessionToken = (body.session_token || '').trim();
    if (!quoteIdInput) {
      return jsonResponse({ ok: false, error: 'quote_id is required.' }, 400);
    }

    const sb = adminClient();
    const { data: quoteRow } = await sb.from('quotes')
      .select('id, stripe_quote_id, submission_id, number')
      .eq('id', quoteIdInput)
      .maybeSingle();
    if (!quoteRow) return jsonResponse({ ok: false, error: 'Quote not found.' }, 404);
    if (!quoteRow.stripe_quote_id) return jsonResponse({ ok: false, error: 'Quote not yet finalised.' }, 409);

    // ---- Authorization
    let authorised = false;
    let actor = 'unknown';
    const caller = await getCallerProfile(req);
    if (caller) {
      authorised = true;
      actor = `admin:${caller.email}`;
    } else if (sessionToken && quoteRow.submission_id) {
      // Studio path. The session_token is the same anchor save-draft uses,
      // hashed and stored on submissions.session_token_hash with an expiry.
      const sessionHash = await sha256Hex(sessionToken);
      const { data: sub } = await sb.from('submissions')
        .select('id, session_expires_at')
        .eq('id', quoteRow.submission_id)
        .eq('session_token_hash', sessionHash)
        .maybeSingle();
      if (sub && sub.session_expires_at && new Date(sub.session_expires_at) > new Date()) {
        authorised = true;
        actor = `studio:${sub.id}`;
      }
    }
    if (!authorised) {
      return jsonResponse({ ok: false, error: 'Not authorised to download this quote.' }, 401);
    }

    // ---- Fetch the PDF from Stripe. The endpoint is on files.stripe.com,
    // not api.stripe.com — calling /v1/quotes/{id}/pdf returns the binary
    // stream with content-type application/pdf when using a server-side
    // secret key.
    const mode = await getStripeMode();
    const secretKey = getStripeKey(mode);
    const stripeResp = await fetch(`https://files.stripe.com/v1/quotes/${encodeURIComponent(quoteRow.stripe_quote_id)}/pdf`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!stripeResp.ok) {
      const text = await stripeResp.text().catch(() => '');
      console.error('get-quote-pdf: Stripe fetch failed', { status: stripeResp.status, text, actor });
      return jsonResponse({ ok: false, error: `Stripe responded ${stripeResp.status}.` }, 502);
    }

    // Re-stream the PDF straight through to the caller. content-disposition
    // = attachment so browsers download rather than render in-tab; the
    // filename uses the human-friendly quote number when available.
    const filename = (quoteRow.number ? `${quoteRow.number}.pdf` : `quote-${quoteRow.id}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
    return new Response(stripeResp.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('get-quote-pdf error:', err);
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
