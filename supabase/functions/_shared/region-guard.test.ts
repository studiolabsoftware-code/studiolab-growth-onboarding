// Run: deno test --allow-read supabase/functions/_shared/region-guard.test.ts
//
// The regression is dated and real: on 2026-08-26 an Auckland studio completed
// the /au/ flow and was charged AUD plus 10% Australian GST, because the form
// hard-sets country from the URL and nothing read the +64 phone or the 0632
// postcode already sitting on her submission.
//
// The false-positive cases matter at least as much as the true positives. This
// guard BLOCKS checkout, so a wrong "you are not in Australia" stops a real
// Australian studio from paying us.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { assessRegion, phoneRegionEvidence, postcodeRegionEvidence, pricingCountryFor } from './region-guard.ts';

// The +64 numbers below are FICTIONAL. This repository is public: use the dial code,
// never a real studio's mobile. The postcode 0632 is a public Auckland area code.

// ---------------------------------------------------------------- the real case
Deno.test('the 2026-08-26 regression: the first paying studio would now be blocked', () => {
  const r = assessRegion({
    country: 'AU',
    contactPhone: '+64211234567',
    addressPostcode: '0632',
  });
  assert(r.mismatch);
  assertEquals(r.expected, 'AU');
  assertEquals(r.contradicting.signal, 'NON_AU');
  // Both fields independently give it away.
  assertEquals(r.evidence.length, 2);
});

// ---------------------------------------------------------------- never on absence
Deno.test('no phone and no postcode is NOT a mismatch', () => {
  assertFalse(assessRegion({ country: 'AU' }).mismatch);
  assertFalse(assessRegion({ country: 'AU', contactPhone: '', addressPostcode: '' }).mismatch);
  assertFalse(assessRegion({ country: 'AU', contactPhone: null, addressPostcode: null }).mismatch);
});

Deno.test('a national-format phone number is ambiguous, never evidence', () => {
  assertEquals(phoneRegionEvidence('0491 570 006'), null);
  assertEquals(phoneRegionEvidence('021 056 9878'), null);   // NZ national, still ambiguous
  assertEquals(phoneRegionEvidence('(02) 9876 5432'), null);
  assertEquals(phoneRegionEvidence('61412345678'), null);    // no +, could be anything
  assertFalse(assessRegion({ country: 'AU', contactPhone: '021 056 9878' }).mismatch);
});

// ---------------------------------------------------------------- legit AU passes
Deno.test('genuine Australian studios are not blocked', () => {
  for (const phone of ['+61412345678', '+61 2 9876 5432', '0061412345678', '+61-4-1234-5678']) {
    assertEquals(phoneRegionEvidence(phone)?.signal, 'AU', phone);
  }
  for (const pc of ['2000', '3000', '4000', '5000', '6000', '7000', '0200', '0800', '0872', '9999', '1000']) {
    assertEquals(postcodeRegionEvidence(pc)?.signal, 'AU', pc);
  }
  assertFalse(assessRegion({ country: 'AU', contactPhone: '+61412345678', addressPostcode: '2000' }).mismatch);
});

// ---------------------------------------------------------------- true positives
Deno.test('non-AU dial codes are caught, and 6x codes are not confused with +61', () => {
  assertEquals(phoneRegionEvidence('+64211234567')?.detail, '+64'); // NZ
  assertEquals(phoneRegionEvidence('+6512345678')?.detail, '+65');  // Singapore
  assertEquals(phoneRegionEvidence('+622112345678')?.detail, '+62'); // Indonesia
  assertEquals(phoneRegionEvidence('+66812345678')?.detail, '+66'); // Thailand
  assertEquals(phoneRegionEvidence('+442079460958')?.detail, '+44');
  assertEquals(phoneRegionEvidence('+13105551234')?.detail, '+1');
  assertEquals(phoneRegionEvidence('+353861234567')?.detail, '+353'); // not read as +35
  for (const p of ['+64211234567', '+13105551234', '+442079460958']) {
    assertEquals(phoneRegionEvidence(p)?.signal, 'NON_AU', p);
  }
});

Deno.test('postcodes that cannot be Australian are caught', () => {
  assertEquals(postcodeRegionEvidence('90210')?.signal, 'NON_AU');    // US ZIP
  assertEquals(postcodeRegionEvidence('SW1A 1AA')?.signal, 'NON_AU'); // UK
  assertEquals(postcodeRegionEvidence('M5V 3L9')?.signal, 'NON_AU');  // Canada
  assertEquals(postcodeRegionEvidence('0632')?.signal, 'NON_AU');     // Auckland
  assertEquals(postcodeRegionEvidence('0100')?.signal, 'NON_AU');     // below every AU range
  assertEquals(postcodeRegionEvidence('0500')?.signal, 'NON_AU');     // the 0300-0799 gap
  assertEquals(postcodeRegionEvidence('')?.signal, undefined);
});

// ---------------------------------------------------------------- the other direction
Deno.test('symmetric: an Australian on the US flow is caught too', () => {
  const r = assessRegion({ country: 'US', contactPhone: '+61412345678', addressPostcode: '3000' });
  assert(r.mismatch);
  assertEquals(r.expected, 'NON_AU');
  assertEquals(r.contradicting.signal, 'AU');
});

Deno.test('a US studio on the US flow passes', () => {
  assertFalse(assessRegion({ country: 'US', contactPhone: '+13105551234', addressPostcode: '90210' }).mismatch);
});

Deno.test('a NZ studio correctly on the US/international flow passes', () => {
  // country is not AU, phone is not AU: nothing contradicts, so nothing blocks.
  assertFalse(assessRegion({ country: 'NZ', contactPhone: '+64211234567', addressPostcode: '0632' }).mismatch);
});

Deno.test('AUS and Australia spellings count as AU, matching currencyForCountry', () => {
  for (const c of ['AU', 'aus', 'Australia', ' AUSTRALIA ']) {
    assert(assessRegion({ country: c, contactPhone: '+64211234567' }).mismatch, c);
  }
});

Deno.test('one contradicting signal is enough even if the other agrees', () => {
  // AU phone, but a Los Angeles ZIP. Something is wrong; do not quietly charge.
  const r = assessRegion({ country: 'AU', contactPhone: '+61412345678', addressPostcode: '90210' });
  assert(r.mismatch);
  assertEquals(r.contradicting.source, 'postcode');
});

// ---------------------------------------------------------------- pricing line
// Two commercial lines, Australia and everyone else. A studio who is not
// Australian is priced on the everyone-else line rather than stopped, because a
// dead end at the last step loses the sale. The primary routing is upstream at
// signup; this is only the backstop for someone who reached a form directly.
Deno.test('a non-Australian on the AU form is repriced, not blocked', () => {
  const r = pricingCountryFor({ country: 'AU', contactPhone: '+64211234567', addressPostcode: '0632' });
  assertEquals(r.country, 'US');
  assert(r.corrected);
  assertEquals(r.evidence?.source, 'phone');
});

// Symmetric, because NEITHER crossing is acceptable. The two catalogs carry
// independently set rates (AI/DFY is AUD 699 against USD 549, not a conversion),
// so a crossing is not about paying more or less, it is the wrong price list.
Deno.test('an Australian on the US form is corrected onto the Australian line', () => {
  const r = pricingCountryFor({ country: 'US', contactPhone: '+61412345678', addressPostcode: '3000' });
  assertEquals(r.country, 'AU');
  assert(r.corrected);
});

Deno.test('a genuine AU studio is priced AU, untouched', () => {
  const r = pricingCountryFor({ country: 'AU', contactPhone: '+61412345678', addressPostcode: '3000' });
  assertEquals(r.country, 'AU');
  assertFalse(r.corrected);
});

Deno.test('no evidence means no correction, so AU pricing stands', () => {
  const r = pricingCountryFor({ country: 'AU' });
  assertEquals(r.country, 'AU');
  assertFalse(r.corrected);
});

Deno.test('an undefined country collapses to null rather than undefined', () => {
  assertEquals(pricingCountryFor({ country: undefined }).country, null);
  assertEquals(pricingCountryFor({ country: null }).country, null);
});
