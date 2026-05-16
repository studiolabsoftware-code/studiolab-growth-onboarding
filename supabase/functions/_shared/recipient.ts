// Shared billing-recipient helpers. Both create-quote and
// create-custom-invoice resolve a recipient (studio or external contact),
// derive an ISO country code, and enforce the AU -> AUD/GST / overseas ->
// USD/no-GST rule. Hoisted here so the two functions stay in lock-step
// (a mismatch would let one path skip GST that the other applies).

export type StudioCountryHint = string | null | undefined;

// Stored country values are inconsistent (legacy submissions allow free
// text, newer flows store ISO-2). Normalise to ISO-2 for the Stripe
// address.country field; null when the value doesn't look like a country
// code (Stripe rejects unknown codes outright).
export function isoCountryForStripe(stored: StudioCountryHint): string | null {
  if (!stored) return null;
  const c = stored.trim().toUpperCase();
  if (c === 'UK') return 'GB';
  if (/^[A-Z]{2}$/.test(c)) return c;
  return null;
}

// Server-side mirror of the admin modal's currency lock. AU recipients
// must be billed AUD with GST; everyone else USD without GST. Returns
// null when the stored country is unknown so a brand-new external
// contact (admin omitted country) can still be invoiced without a
// forced currency.
export function expectedCurrencyForCountry(country: StudioCountryHint): 'AUD' | 'USD' | null {
  if (!country) return null;
  const c = country.trim().toUpperCase();
  if (c === 'AU' || c === 'AUS' || c === 'AUSTRALIA') return 'AUD';
  if (/^[A-Z]{2,3}$/.test(c) || c.length > 3) return 'USD';
  return null;
}

// Validates a chosen currency against the stored country. Returns null
// on pass; returns an `{ error, code }` shape (matching jsonResponse 400
// shape) on mismatch. The `verb` keeps the error copy aligned with the
// flow ('quoted in AUD' vs 'invoiced in AUD').
export function validateCurrencyForCountry(opts: {
  currency: 'AUD' | 'USD';
  country: StudioCountryHint;
  recipientLabel: 'studio' | 'recipient';
  verb: 'quoted' | 'invoiced';
}): { error: string; code: string } | null {
  const expected = expectedCurrencyForCountry(opts.country);
  if (!expected || expected === opts.currency) return null;
  const noun = opts.recipientLabel === 'studio' ? 'studios' : 'recipients';
  const where = opts.recipientLabel === 'studio' ? 'Australian' : 'Australian';
  return expected === 'AUD'
    ? {
        error: `${where} ${noun} must be ${opts.verb} in AUD (10% GST applies).`,
        code: 'currency_country_mismatch',
      }
    : {
        error: `Overseas ${noun} must be ${opts.verb} in USD (no GST).`,
        code: 'currency_country_mismatch',
      };
}
