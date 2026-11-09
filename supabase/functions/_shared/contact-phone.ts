// The studio's mobile number, collected at signup for account and support texts only (never marketing).
// Stored as E.164 with the time and source of the notice that was shown beside the field. There is no
// tick box by design: the number is required and the notice says what it is used for and how to opt out.
// site/js/form.js carries a client copy of toE164; keep the two in step (contact-phone.test.ts).

export const PHONE_NOTICE =
  "We'll use this number to contact you about your StudioLAB account and support. Reply STOP to any text to opt out.";

const DEFAULT_DIAL: Record<string, string> = { au: '61', us: '1' };

// Returns the number in E.164, or null when it cannot be one. `region` is the signup line ('au' | 'us').
export function toE164(raw: unknown, region?: string | null): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(cleaned.replace(/^00/, '+'))) return null;
  let digits: string;
  if (cleaned.charAt(0) === '+') digits = cleaned.slice(1);
  else if (cleaned.slice(0, 2) === '00') digits = cleaned.slice(2);
  else {
    const dial = DEFAULT_DIAL[String(region || '').toLowerCase()];
    if (!dial) return null; // national format with no line to read it against
    digits = dial + cleaned.replace(/^0+/, '');
  }
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  // Australia: only mobiles take texts (+61 4xx xxx xxx). NANP: 10 digits, area code and exchange start 2-9.
  if (digits.startsWith('61') && !/^614\d{8}$/.test(digits)) return null;
  if (digits.startsWith('1') && !/^1[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return '+' + digits;
}

// What to write beside contact_phone: the consent time and source, stamped whenever the stored number
// changes or was never stamped. `source` names the surface that showed the notice.
export function phoneConsentFields(
  stored: { contact_phone?: unknown; contact_phone_consent_at?: unknown } | null,
  e164: string,
  source: string,
  nowIso: string,
): Record<string, unknown> {
  const same = stored?.contact_phone === e164 && !!stored?.contact_phone_consent_at;
  return same
    ? { contact_phone: e164 }
    : { contact_phone: e164, contact_phone_consent_at: nowIso, contact_phone_consent_source: source };
}
