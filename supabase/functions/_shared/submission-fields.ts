// Which submission columns a studio may write, for save-draft and for the dashboard's server-to-server
// path. Moved here from save-draft so both read one list, and so a test can hold the app path to it.

// Whitelist of columns the client may write. Server-only fields are excluded.
export const ALLOWED_FIELDS = new Set([
  // 'plan' is DELIBERATELY ABSENT (removed 2026-08-20). It used to be here, and it was the reason a
  // studio could be priced on a plan they never signed up for: the form sends plan on every autosave
  // from the URL it was served at (js/form.js buildPayload), and create-checkout-session prices off
  // submissions.plan. So opening /au/launch/ instead of /au/ai/ and letting the form autosave rewrote
  // the row to Launch and charged the Launch setup fee.
  //
  // Nothing legitimate needs it here. There are no plan-card elements in any of the six form pages;
  // the row's plan is set server-side, from an allow-list-validated value, by verify-otp (which now
  // prefers the plan on the studio's actual signup record) and by claim-draft for the generic-mode
  // plan picker. A studio changing plan gets a different draft row from those functions, never an
  // in-place rewrite from an autosave.
  'setup_type','studio_name','legal_name','country','timezone','studio_type',
  'address','website','support_url','first_name','last_name','contact_phone','role',
  'studiolab_email','logo_url','primary_colour','secondary_colour','sign_off',
  'email_tone','footer_notes','studio_description','from_name','reply_email',
  'custom_domain','email_domain','dns_access','sms_type','area_code','port_number',
  'sms_tone','lead_sources',
  // Onboarding form refinement (migration 044). Additive, contract-safe.
  // sms_setup_requested replaces the retired number-preference / Twilio /
  // porting capture; the retired sms_type/area_code/port_number/has_twilio/
  // twilio_number keys stay in the allow-list so older drafts still round-trip,
  // but the current form no longer sends them. Consent trio is the audited
  // send-on-behalf authorisation from the review step.
  'sms_setup_requested',
  'consent_send_on_behalf','consent_captured_at','consent_version',
  'extra_notes',
  // The kb_* and voice_* columns are deliberately NOT writable here. They have
  // no owner at all now: StudioLAB Growth builds the knowledge base itself, and the
  // onboarding form has no inputs for them. While they were allowed, the form
  // sent every one as null on each save, which nulled the scraped knowledge
  // base whenever a Dominate AI studio cancelled at Stripe and returned to the
  // still-'draft' form. The post-submit guard below does not cover that window.
  // Removing them from this allow-list is the backstop; the form no longer
  // sends them either.
  // Optional future-proof URLs for studios planning to upgrade later.
  'google_business_url','facebook_url','instagram_handle','booking_url',
  // Additional social handles collected on Scale and AI lead-sources step.
  'tiktok_handle','youtube_url',
  // Optional brand-colour reference screenshot for hex matching.
  'brand_reference_url',
  // Optional Twilio account connection (Scale and AI).
  'has_twilio', 'twilio_number',
  // Business identity & structured address (migration 040, Phase 1 of the
  // onboarding access & compliance plan). EIN is stored plain text; the admin
  // UI masks it on display. Do not log these fields.
  //
  // ssn_last4 is deliberately NOT writable. We stopped collecting it on
  // 2026-08-20: a US sole proprietor proves identity through the platform's own
  // A2P brand check, a third-party verification they complete in their own
  // sub-account, which we can neither run for them nor feed digits into. The
  // column stays for any historical row; nothing may write it again.
  //
  // The identifier columns are country-scoped, not line-scoped: which of them a
  // studio is asked for comes from _shared/business-identifiers.ts, keyed on the
  // studio's own country. The form sends ALL of them on every save, with the
  // ones that country does not issue set to null, so switching entity type or
  // resolving a country late cannot leave a stale ACN or EIN on the row.
  'legal_business_name','trading_name','business_type',
  'ein','abn','acn','nzbn','crn','bn','tax_id',
  'business_email','business_email_is_personal_domain',
  'address_street','address_city','address_region','address_postcode',
]);

export function pickAllowed(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (ALLOWED_FIELDS.has(k)) out[k] = v === '' ? null : v;
  }
  return out;
}

// The questions the dashboard asks in the app. Every one is also in ALLOWED_FIELDS (a test holds that).
// Left out on purpose: setup_type (chosen beside the pay button in P3), consent_captured_at (stamped by
// the server), and the retired number-preference and Twilio keys that only old drafts carry.
export const APP_ANSWER_FIELDS = [
  'studio_name', 'legal_name', 'country', 'timezone', 'studio_type', 'address', 'website', 'support_url',
  'first_name', 'last_name', 'contact_phone', 'role', 'studiolab_email', 'logo_url', 'primary_colour',
  'secondary_colour', 'sign_off', 'email_tone', 'footer_notes', 'studio_description', 'from_name',
  'reply_email', 'custom_domain', 'email_domain', 'dns_access', 'sms_setup_requested', 'sms_tone',
  'lead_sources', 'consent_send_on_behalf', 'consent_version', 'extra_notes', 'google_business_url',
  'facebook_url', 'instagram_handle', 'booking_url', 'tiktok_handle', 'youtube_url', 'brand_reference_url',
  'legal_business_name', 'trading_name', 'business_type', 'ein', 'abn', 'acn', 'nzbn', 'crn', 'bn', 'tax_id',
  'business_email', 'business_email_is_personal_domain', 'address_street', 'address_city', 'address_region',
  'address_postcode',
] as const;
