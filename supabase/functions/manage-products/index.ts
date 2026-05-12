// Catalog management: update price (with reason + history append), toggle
// active, edit name/description, and sync the row to Stripe as a Product.
// Open to any active admin user (owner/admin/va) — VAs operate the catalog
// day to day. Owner-only controls (mode toggle, keys, defaults) stay in
// save-payment-settings.

import { preflight, jsonResponse } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { getCallerProfile } from '../_shared/caller.ts';
import { getStripeKey, getStripeMode, stripeRequest } from '../_shared/stripe.ts';

type Product = {
  id: string;
  plan: string;
  setup_type: string;
  currency: string;
  stripe_product_id: string | null;
  name: string;
  description: string | null;
  amount_cents: number;
  tax_code: string;
  active: boolean;
};

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;

  try {
    const caller = await getCallerProfile(req);
    if (!caller) return jsonResponse({ ok: false, error: 'Not authorised.' }, 401);

    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || '');
    const sb = adminClient();

    if (action === 'update_price') {
      const id = String(body.id || '');
      const newAmount = Number(body.amount_cents);
      const reason = String(body.reason || '').trim();
      if (!id) return jsonResponse({ ok: false, error: 'Missing product id.' }, 400);
      if (!Number.isInteger(newAmount) || newAmount < 0) {
        return jsonResponse({ ok: false, error: 'amount_cents must be a non-negative integer.' }, 400);
      }
      if (!reason) {
        return jsonResponse({ ok: false, error: 'A reason is required for price changes.' }, 400);
      }

      const { data: existing, error: getErr } = await sb.from('products')
        .select('id, amount_cents')
        .eq('id', id)
        .maybeSingle();
      if (getErr) throw getErr;
      if (!existing) return jsonResponse({ ok: false, error: 'Product not found.' }, 404);

      // No-op guard: avoid history spam if nothing changed.
      if (existing.amount_cents === newAmount) {
        return jsonResponse({ ok: true, unchanged: true });
      }

      const prevAmount = existing.amount_cents;

      const { data: updated, error: upErr } = await sb.from('products')
        .update({ amount_cents: newAmount, updated_by: caller.id, effective_from: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (upErr) throw upErr;

      const { error: histErr } = await sb.from('product_price_history').insert({
        product_id: id,
        amount_cents: newAmount,
        previous_amount_cents: prevAmount,
        reason,
        changed_by: caller.id,
      });
      if (histErr) throw histErr;

      return jsonResponse({ ok: true, product: updated });
    }

    if (action === 'set_active') {
      const id = String(body.id || '');
      const active = !!body.active;
      if (!id) return jsonResponse({ ok: false, error: 'Missing product id.' }, 400);

      const { data, error } = await sb.from('products')
        .update({ active, updated_by: caller.id })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return jsonResponse({ ok: true, product: data });
    }

    if (action === 'update_details') {
      const id = String(body.id || '');
      const name = typeof body.name === 'string' ? body.name.trim() : null;
      const description = typeof body.description === 'string' ? body.description.trim() : null;
      const taxCode = typeof body.tax_code === 'string' ? body.tax_code.trim() : null;
      if (!id) return jsonResponse({ ok: false, error: 'Missing product id.' }, 400);
      const patch: Record<string, unknown> = { updated_by: caller.id };
      if (name !== null) { if (!name) return jsonResponse({ ok: false, error: 'Name cannot be blank.' }, 400); patch.name = name; }
      if (description !== null) patch.description = description || null;
      if (taxCode !== null) { if (!/^txcd_[0-9a-z]+$/.test(taxCode)) return jsonResponse({ ok: false, error: 'tax_code must look like txcd_…' }, 400); patch.tax_code = taxCode; }
      if (Object.keys(patch).length === 1) return jsonResponse({ ok: false, error: 'Nothing to update.' }, 400);

      const { data, error } = await sb.from('products')
        .update(patch).eq('id', id).select('*').single();
      if (error) throw error;
      return jsonResponse({ ok: true, product: data });
    }

    if (action === 'sync_to_stripe') {
      const id = String(body.id || '');
      if (!id) return jsonResponse({ ok: false, error: 'Missing product id.' }, 400);

      const { data: product, error: getErr } = await sb.from('products')
        .select('*').eq('id', id).maybeSingle() as { data: Product | null; error: unknown };
      if (getErr) throw getErr;
      if (!product) return jsonResponse({ ok: false, error: 'Product not found.' }, 404);

      const mode = await getStripeMode();
      const secretKey = getStripeKey(mode);

      // Stripe Products are shared across our line_items[].price_data calls
      // for reporting only. Currency lives on price_data, not on the Product,
      // so AUD + USD rows can collapse to one Stripe Product per plan+setup
      // if you ever want — but we keep one per row for clarity.
      const payload = {
        name: product.name,
        description: product.description || undefined,
        tax_code: product.tax_code,
        metadata: {
          studiolab_product_id: product.id,
          plan: product.plan,
          setup_type: product.setup_type,
          currency: product.currency,
        },
      };

      let stripeResult;
      if (product.stripe_product_id) {
        stripeResult = await stripeRequest(
          'POST',
          `products/${encodeURIComponent(product.stripe_product_id)}`,
          payload,
          secretKey,
        );
      } else {
        stripeResult = await stripeRequest(
          'POST',
          'products',
          payload,
          secretKey,
          `studiolab-product-${product.id}`,
        );
      }

      if (!stripeResult.ok) {
        return jsonResponse({ ok: false, error: stripeResult.error || 'Stripe sync failed.', stripe_status: stripeResult.status }, 502);
      }

      const stripeProduct = stripeResult.body as { id: string };
      const { data: updated, error: upErr } = await sb.from('products')
        .update({
          stripe_product_id: stripeProduct.id,
          updated_by: caller.id,
        })
        .eq('id', id)
        .select('*')
        .single();
      if (upErr) throw upErr;

      return jsonResponse({ ok: true, product: updated, stripe_mode: mode });
    }

    if (action === 'history') {
      const id = String(body.id || '');
      if (!id) return jsonResponse({ ok: false, error: 'Missing product id.' }, 400);
      const { data, error } = await sb.from('product_price_history')
        .select('id, amount_cents, previous_amount_cents, reason, changed_at, changed_by')
        .eq('product_id', id)
        .order('changed_at', { ascending: false })
        .limit(100);
      if (error) throw error;

      // Resolve changed_by → admin_users.name for display.
      const userIds = Array.from(new Set((data || []).map((r) => r.changed_by).filter(Boolean) as string[]));
      let userMap: Record<string, string> = {};
      if (userIds.length) {
        const { data: users } = await sb.from('admin_users')
          .select('id, name')
          .in('id', userIds);
        userMap = Object.fromEntries((users || []).map((u) => [u.id, u.name]));
      }

      const enriched = (data || []).map((r) => ({
        ...r,
        changed_by_name: r.changed_by ? (userMap[r.changed_by as string] || '—') : null,
      }));
      return jsonResponse({ ok: true, history: enriched });
    }

    return jsonResponse({ ok: false, error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('manage-products error:', err);
    return jsonResponse({ ok: false, error: String((err as Error)?.message || err) }, 500);
  }
});
