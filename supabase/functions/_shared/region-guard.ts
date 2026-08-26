// Does the studio's own data contradict the region its form hard-set?
//
// WHY. `js/form.js` no longer asks for a country. `getCountryValue()` falls back
// to the URL, so every studio on /au/ is stored as country='AU' and every studio
// on /us/ as country='US'. `pricing.ts` then decides currency from that field
// alone: AU -> AUD + 10% GST, everything else -> USD.
//
// On 2026-08-26 a studio in Auckland completed the /au/ flow. Her submission
// carried a +64 mobile and address_postcode '0632' before she
// reached checkout, and nothing looked at either, so she was charged in AUD with
// Australian GST added. `create-checkout-session` already blocked the opposite
// mistake (an Australian on the US form, via isAustralianFreeText) but had no
// mirror for this direction.
//
// THE RULE THIS ENCODES: block only on a POSITIVE contradicting signal, never on
// absence. A studio with no phone and no postcode passes. A national-format
// phone number with no country code passes, because it is genuinely ambiguous.
// Getting this backwards would block legitimate Australian studios from paying,
// which is far worse than the fault being fixed.

export type RegionSignal = 'AU' | 'NON_AU';

export interface RegionEvidence {
  /** Which field produced it, for an error message a human can act on. */
  source: 'phone' | 'postcode';
  signal: RegionSignal;
  /** The specific value that decided it, e.g. '+64' or '0632'. */
  detail: string;
}

/**
 * Australia's allocated 4-digit postcode ranges. Everything from 1000 to 9999 is
 * in use; below 1000 only the ACT large-volume block (0200-0299) and the NT
 * block (0800-0999) exist. So 0632, a Rosedale/Auckland code, is not merely
 * unusual, it is not an Australian postcode at all.
 */
function isAllocatedAuPostcode(n: number): boolean {
  if (n >= 1000 && n <= 9999) return true;
  if (n >= 200 && n <= 299) return true;
  if (n >= 800 && n <= 999) return true;
  return false;
}

/**
 * Read an international dial code off a phone number.
 *
 * Returns null for anything without an explicit international prefix. A number
 * written nationally ('0421 056 987') could belong to several countries and is
 * NOT evidence of anything.
 */
export function phoneRegionEvidence(phone: string | null | undefined): RegionEvidence | null {
  const raw = String(phone || '').trim();
  if (!raw) return null;

  // Strip the punctuation people actually type: spaces, dashes, dots, brackets.
  const cleaned = raw.replace(/[\s().-]/g, '');

  let digits: string;
  if (cleaned.startsWith('+')) {
    digits = cleaned.slice(1);
  } else if (cleaned.startsWith('00')) {
    // 00 is the international prefix across Europe, NZ and much of Asia.
    digits = cleaned.slice(2);
  } else {
    return null; // national format, ambiguous, not evidence
  }

  if (!/^\d{4,}$/.test(digits)) return null; // not a usable international number

  // +61 is Australia. Match it exactly rather than by prefix: +62, +64, +65 and
  // +66 all share the leading 6 and are Indonesia, New Zealand, Singapore and
  // Thailand respectively.
  if (digits.startsWith('61')) {
    return { source: 'phone', signal: 'AU', detail: '+61' };
  }

  // Longest-first so +353 is not read as +35, and +1 stays the fallback.
  const known = ['353', '852', '971', '64', '65', '66', '62', '60', '44', '49', '33', '27', '91', '81', '86', '1'];
  const code = known.find((c) => digits.startsWith(c)) || digits.slice(0, 2);
  return { source: 'phone', signal: 'NON_AU', detail: `+${code}` };
}

/**
 * Judge a postcode. Australian postcodes are exactly four digits and fall in the
 * allocated ranges above; a ZIP (5 digits) or a UK/Canadian code (letters) is
 * positive evidence of somewhere else.
 */
export function postcodeRegionEvidence(postcode: string | null | undefined): RegionEvidence | null {
  const raw = String(postcode || '').trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, '');
  if (/[A-Za-z]/.test(compact)) {
    return { source: 'postcode', signal: 'NON_AU', detail: raw };
  }
  if (!/^\d+$/.test(compact)) return null; // punctuation soup, not evidence

  if (compact.length !== 4) {
    return { source: 'postcode', signal: 'NON_AU', detail: raw };
  }
  return isAllocatedAuPostcode(Number(compact))
    ? { source: 'postcode', signal: 'AU', detail: raw }
    : { source: 'postcode', signal: 'NON_AU', detail: raw };
}

export interface RegionCheckInput {
  /** The submission's stored country, which the form set from the URL. */
  country: string | null | undefined;
  contactPhone?: string | null;
  addressPostcode?: string | null;
}

export type RegionCheck =
  | { mismatch: false; evidence: RegionEvidence[] }
  | { mismatch: true; expected: RegionSignal; evidence: RegionEvidence[]; contradicting: RegionEvidence };

/** Country values that mean Australia, matching pricing.ts's currencyForCountry. */
function expectedSignalFor(country: string | null | undefined): RegionSignal {
  const c = String(country || '').trim().toUpperCase();
  return (c === 'AU' || c === 'AUS' || c === 'AUSTRALIA') ? 'AU' : 'NON_AU';
}

/**
 * Compare the region the form assumed against what the studio's own contact
 * details say. Symmetric on purpose: it catches a New Zealand studio priced in
 * AUD with GST, and equally an Australian studio priced in USD with no GST,
 * which is our own tax problem rather than theirs.
 */
export function assessRegion(input: RegionCheckInput): RegionCheck {
  const expected = expectedSignalFor(input.country);
  const evidence = [
    phoneRegionEvidence(input.contactPhone),
    postcodeRegionEvidence(input.addressPostcode),
  ].filter((e): e is RegionEvidence => e !== null);

  const contradicting = evidence.find((e) => e.signal !== expected);
  if (!contradicting) return { mismatch: false, evidence };
  return { mismatch: true, expected, evidence, contradicting };
}

/**
 * The country this submission should actually be PRICED on.
 *
 * There are two commercial lines: Australia, and everyone else. The primary
 * routing happens upstream, at signup, where the platform already knows the
 * studio's country and the invite link points at the right pathway. This is the
 * backstop for someone who reached a form directly, which is exactly how an
 * Auckland studio completed the /au/ flow on 2026-08-26 and was charged
 * Australian GST.
 *
 * It corrects DOWNWARD only, and deliberately so:
 *
 *   non-Australian on the AU form -> priced on the everyone-else line (USD, no
 *   GST). They are currently being OVERcharged, so applying the correction
 *   silently only ever reduces what they pay.
 *
 *   Australian on the US form -> NOT auto-corrected here. That direction would
 *   silently ADD 10% GST to a price they already saw, and quietly charging
 *   someone more is not a correction. `create-checkout-session` keeps its
 *   existing explicit block for that case.
 */
export function pricingCountryFor(input: RegionCheckInput): {
  country: string | null;
  corrected: boolean;
  evidence?: RegionEvidence;
} {
  // Normalised to `string | null` for resolvePricing. currencyForCountry treats
  // null and undefined identically (both fall through to USD), so collapsing
  // them changes nothing.
  const passthrough = input.country ?? null;
  const check = assessRegion(input);
  if (!check.mismatch) return { country: passthrough, corrected: false };
  if (check.expected !== 'AU') return { country: passthrough, corrected: false };
  // 'US' is the everyone-else line, not a claim about where they are. It is what
  // currencyForCountry maps to USD with no GST.
  return { country: 'US', corrected: true, evidence: check.contradicting };
}
