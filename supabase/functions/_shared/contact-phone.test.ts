import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { phoneConsentFields, toE164 } from './contact-phone.ts';

Deno.test('AU mobiles normalise to E.164, landlines and junk do not', () => {
  assertEquals(toE164('0412 345 678', 'au'), '+61412345678');
  assertEquals(toE164('+61 412 345 678', 'us'), '+61412345678');
  assertEquals(toE164('0061412345678', 'au'), '+61412345678');
  assertEquals(toE164('02 9999 9999', 'au'), null);
  assertEquals(toE164('0412 345', 'au'), null);
  assertEquals(toE164('abc', 'au'), null);
  assertEquals(toE164(null, 'au'), null);
});

Deno.test('US numbers normalise; national format needs a known line', () => {
  assertEquals(toE164('(415) 555-0123', 'us'), '+14155550123');
  assertEquals(toE164('+1 415 555 0123', undefined), '+14155550123');
  assertEquals(toE164('415 555 0123', undefined), null);
  assertEquals(toE164('(115) 555-0123', 'us'), null);
});

Deno.test('other countries pass when written in E.164', () => {
  assertEquals(toE164('+44 7700 900123', 'us'), '+447700900123');
});

Deno.test('consent is stamped on a new or changed number, not on a repeat save', () => {
  const now = '2026-11-09T00:00:00.000Z';
  assertEquals(phoneConsentFields(null, '+61412345678', 'onboarding_form', now), {
    contact_phone: '+61412345678', contact_phone_consent_at: now, contact_phone_consent_source: 'onboarding_form',
  });
  assertEquals(phoneConsentFields({ contact_phone: '+61412345678', contact_phone_consent_at: 't0' }, '+61412345678', 'onboarding_form', now), {
    contact_phone: '+61412345678',
  });
  assertEquals(phoneConsentFields({ contact_phone: '0412345678', contact_phone_consent_at: null }, '+61412345678', 'onboarding_form', now).contact_phone_consent_at, now);
});
