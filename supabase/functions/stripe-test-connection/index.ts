// Owner-only diagnostic. Reads the current stripe_mode from payment_settings,
// pulls the matching secret key from Edge Function env, and probes Stripe's
// /v1/balance and /v1/tax/registrations endpoints. Returns a small status
// payload the admin Settings page renders. Persists the result + timestamp
// back into payment_settings so the UI can show "last tested" without re-
// hitting Stripe on every load.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';

type StripeBalance = {
  object: string;
  livemode: boolean;
  available?: Array<{ amount: number; currency: string }>;
};

type StripeAccount = {
  id: string;
  business_profile?: { name?: string };
  country?: string;
  default_currency?: string;
  email?: string;
};

type StripeTaxRegistration = {
  id: string;
  country: string;
  status: string;
  type?: string;
};

async function stripeGet<T>(path: string, secretKey: string): Promise<{ ok: boolean; status: number; body: T | { error?: { message?: string } } }>
{
  const resp = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: {
      'Authorization': `Bearer ${secretKey}`,
      'Stripe-Version': '2024-12-18.acacia',
    },
  });
  let body: unknown = null;
  try { body = await resp.json(); } catch (_) { body = {}; }
  return { ok: resp.ok, status: resp.status, body: body as T };
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 8)}••••${key.slice(-4)}`;
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Not authorised.' }, 401);
    if (caller.role !== 'owner') {
      return jsonResponse({ ok: false, error: 'Only the owner can test the Stripe connection.' }, 403);
    }

    const sb = adminClient();
    const { data: settings, error: settingsErr } = await sb.from('payment_settings')
      .select('stripe_mode')
      .eq('id', 1)
      .maybeSingle();
    if (settingsErr) throw settingsErr;

    const mode = (settings?.stripe_mode || 'test') as 'test' | 'live';
    const envKey = mode === 'live' ? 'STRIPE_SECRET_KEY_LIVE' : 'STRIPE_SECRET_KEY_TEST';
    const envWebhook = mode === 'live' ? 'STRIPE_WEBHOOK_SECRET_LIVE' : 'STRIPE_WEBHOOK_SECRET_TEST';
    const secretKey = Deno.env.get(envKey) || '';
    const webhookSecret = Deno.env.get(envWebhook) || '';

    const detail: Record<string, unknown> = {
      mode,
      secret_key_present: !!secretKey,
      secret_key_fingerprint: secretKey ? maskKey(secretKey) : null,
      webhook_secret_present: !!webhookSecret,
      env_var_name: envKey,
      webhook_env_var_name: envWebhook,
    };

    if (!secretKey) {
      detail.error = `Edge Function secret ${envKey} is not set. Add it via the Supabase dashboard before testing.`;
      await sb.from('payment_settings').update({
        last_connection_test_at: new Date().toISOString(),
        last_connection_test_ok: false,
        last_connection_test_detail: detail,
      }).eq('id', 1);
      return jsonResponse({ ok: false, ...detail });
    }

    // Probe Stripe with two cheap GETs so we can confirm both auth and tax setup.
    const [balanceResp, accountResp, taxResp] = await Promise.all([
      stripeGet<StripeBalance>('balance', secretKey),
      stripeGet<StripeAccount>('account', secretKey),
      stripeGet<{ data: StripeTaxRegistration[] }>('tax/registrations?limit=100', secretKey),
    ]);

    if (!balanceResp.ok) {
      const errMsg = (balanceResp.body as { error?: { message?: string } })?.error?.message
        || `Stripe responded ${balanceResp.status}.`;
      detail.error = errMsg;
      detail.stripe_status = balanceResp.status;
      await sb.from('payment_settings').update({
        last_connection_test_at: new Date().toISOString(),
        last_connection_test_ok: false,
        last_connection_test_detail: detail,
      }).eq('id', 1);
      return jsonResponse({ ok: false, ...detail });
    }

    const balance = balanceResp.body as StripeBalance;
    const account = accountResp.ok ? (accountResp.body as StripeAccount) : null;

    // Stripe returns livemode=true on the balance object when called with a
    // live key. Detecting a mismatch early prevents the "I thought I was in
    // test mode" foot-gun.
    const livemodeReported = balance?.livemode === true;
    const mismatched = (mode === 'live' && !livemodeReported) || (mode === 'test' && livemodeReported);

    let auGstRegistered = false;
    let auGstStatus: string | null = null;
    if (taxResp.ok) {
      const regs = (taxResp.body as { data: StripeTaxRegistration[] }).data || [];
      const au = regs.find((r) => r.country === 'AU' && (r.status === 'active' || r.status === 'scheduled'));
      if (au) {
        auGstRegistered = au.status === 'active';
        auGstStatus = au.status;
      }
    }

    Object.assign(detail, {
      account_id: account?.id || null,
      account_name: account?.business_profile?.name || null,
      account_country: account?.country || null,
      livemode_reported: livemodeReported,
      mode_matches: !mismatched,
      au_gst_registered: auGstRegistered,
      au_gst_status: auGstStatus,
      webhook_endpoint: `${Deno.env.get('SUPABASE_URL') || ''}/functions/v1/stripe-webhook`,
    });

    const overallOk = !mismatched && !!account?.id;

    await sb.from('payment_settings').update({
      last_connection_test_at: new Date().toISOString(),
      last_connection_test_ok: overallOk,
      last_connection_test_detail: detail,
    }).eq('id', 1);

    return jsonResponse({ ok: overallOk, ...detail });
  } catch (err) {
    console.error('stripe-test-connection error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
