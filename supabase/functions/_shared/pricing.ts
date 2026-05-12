// Shared pricing resolver. Used by resolve-pricing (preview, no DB writes)
// and create-checkout-session (real, snapshots into submission_pricing).
// Currency is decided server-side from the submission's country — AU → AUD,
// everything else → USD. Tax preview is 10% for AUD only; the real tax line
// is added by Stripe Tax at Checkout time via automatic_tax.

import { adminClient } from './supabase.ts';

export type Currency = 'AUD' | 'USD';
export type Plan = 'launch' | 'scale' | 'ai';
export type SetupType = 'dfy' | 'guided';

export function currencyForCountry(country: string | null | undefined): Currency {
  if (!country) return 'USD';
  const c = country.trim().toUpperCase();
  if (c === 'AU' || c === 'AUS' || c === 'AUSTRALIA') return 'AUD';
  return 'USD';
}

export type PricingResult = {
  ok: true;
  product_id: string;
  product_name: string;
  product_description: string | null;
  stripe_product_id: string | null;
  tax_code: string;
  list_amount_cents: number;
  discount_code_id: string | null;
  discount_code: string | null;
  discount_amount_cents: number | null;
  final_amount_cents: number;
  currency: Currency;
  tax_rate_percent: number;
  tax_amount_cents: number;
  total_with_tax_cents: number;
  has_active_discounts: boolean;
} | { ok: false; error: string; code?: string };

// Returns true if there is at least one currently-active, non-expired
// discount code that could be applied to this product. Used by the studio
// form to decide whether to show the discount input at all.
export async function hasUsableDiscounts(productId: string, currency: Currency): Promise<boolean> {
  const sb = adminClient();
  const nowIso = new Date().toISOString();
  // Filter what we can in SQL; the applies_to_product_ids array and the
  // redemption cap need a post-fetch check.
  const { data, error } = await sb.from('discount_codes')
    .select('id, applies_to_all, applies_to_product_ids, max_redemptions, redemption_count, kind, currency')
    .eq('active', true)
    .or(`valid_until.is.null,valid_until.gte.${nowIso}`)
    .or(`valid_from.is.null,valid_from.lte.${nowIso}`);
  if (error) return false;
  if (!data || !data.length) return false;
  return data.some((c) => {
    if (c.max_redemptions && c.redemption_count >= c.max_redemptions) return false;
    if (!c.applies_to_all) {
      const ids = (c.applies_to_product_ids as string[] | null) || [];
      if (!ids.includes(productId)) return false;
    }
    if (c.kind === 'fixed_amount' && c.currency !== currency) return false;
    return true;
  });
}

export async function resolvePricing(args: {
  plan: Plan;
  setup_type: SetupType;
  country: string | null;
  discount_code?: string | null;
}): Promise<PricingResult> {
  const sb = adminClient();
  const currency = currencyForCountry(args.country);

  const { data: product, error: prodErr } = await sb
    .from('products')
    .select('id, name, description, stripe_product_id, tax_code, amount_cents, active')
    .eq('plan', args.plan)
    .eq('setup_type', args.setup_type)
    .eq('currency', currency)
    .maybeSingle();
  if (prodErr) return { ok: false, error: prodErr.message };
  if (!product) return { ok: false, error: `No catalog row found for ${args.plan}/${args.setup_type}/${currency}.`, code: 'product_missing' };
  if (!product.active) return { ok: false, error: `This plan is not currently available for purchase.`, code: 'product_inactive' };

  const list = Number(product.amount_cents || 0);

  let discountAmount: number | null = null;
  let discountId: string | null = null;
  let discountCode: string | null = null;
  if (args.discount_code) {
    const raw = String(args.discount_code).trim().toUpperCase();
    const { data: codeRow } = await sb
      .from('discount_codes')
      .select('*')
      .ilike('code', raw)
      .maybeSingle();
    if (!codeRow) return { ok: false, error: 'That discount code was not recognised.', code: 'discount_invalid' };
    if (!codeRow.active) return { ok: false, error: 'That discount code is no longer active.', code: 'discount_inactive' };
    const now = new Date();
    if (codeRow.valid_from && new Date(codeRow.valid_from) > now) {
      return { ok: false, error: 'That discount code is not yet active.', code: 'discount_not_started' };
    }
    if (codeRow.valid_until && new Date(codeRow.valid_until) < now) {
      return { ok: false, error: 'That discount code has expired.', code: 'discount_expired' };
    }
    if (codeRow.max_redemptions && codeRow.redemption_count >= codeRow.max_redemptions) {
      return { ok: false, error: 'That discount code has reached its redemption limit.', code: 'discount_exhausted' };
    }
    if (!codeRow.applies_to_all) {
      const allowed: string[] = codeRow.applies_to_product_ids || [];
      if (!allowed.includes(product.id)) {
        return { ok: false, error: 'That discount code does not apply to this product.', code: 'discount_not_applicable' };
      }
    }
    if (codeRow.kind === 'fixed_amount' && codeRow.currency !== currency) {
      return { ok: false, error: `That discount code is for ${codeRow.currency}, not ${currency}.`, code: 'discount_wrong_currency' };
    }
    if (codeRow.kind === 'percentage') {
      discountAmount = Math.round(list * (codeRow.value / 100));
    } else {
      discountAmount = Math.min(codeRow.value, list);
    }
    discountId = codeRow.id;
    discountCode = codeRow.code;
  }

  const finalAmount = Math.max(0, list - (discountAmount || 0));
  const taxRate = currency === 'AUD' ? 10 : 0;
  const taxAmount = Math.round(finalAmount * (taxRate / 100));
  const totalWithTax = finalAmount + taxAmount;
  const hasActiveDiscounts = await hasUsableDiscounts(product.id, currency);

  return {
    ok: true,
    product_id: product.id,
    product_name: product.name,
    product_description: product.description,
    stripe_product_id: product.stripe_product_id,
    tax_code: product.tax_code,
    list_amount_cents: list,
    discount_code_id: discountId,
    discount_code: discountCode,
    discount_amount_cents: discountAmount,
    final_amount_cents: finalAmount,
    currency,
    tax_rate_percent: taxRate,
    tax_amount_cents: taxAmount,
    total_with_tax_cents: totalWithTax,
    has_active_discounts: hasActiveDiscounts,
  };
}
