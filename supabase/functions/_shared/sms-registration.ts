// What SMS registration actually involves, in the studio's own country.
//
// WHY THIS EXISTS. The Setup Checklist's `sms_a2p` tile described one country's
// process to every studio. It opened with "In the US that means registering your
// business with the 10DLC carrier registry", then asked everyone for a US
// Campaign Registry industry vertical, a monthly message volume for a US
// campaign throughput tier, and an opt-in screenshot for US Toll-Free
// verification. A studio in Manchester or Auckland read three fields of American
// telecoms machinery that does not apply to them, and the steps promised carrier
// approval that nobody is waiting on.
//
// Same defect class as business-identifiers.ts, one surface over: the copy was
// keyed on the commercial line rather than the studio's country.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not try to be a global telecoms
// regulator. We know the US process because we run it; for everywhere else the
// honest claim is what WE do, not what the local rulebook says. So there are two
// shapes here, not five: the US registry, and "we handle whatever your network
// asks for". No statute is named, no approval timeline is promised where we do
// not have one, and no country is told there is no registration when we have not
// verified that.
//
// Canada is a KNOWN UNCERTAINTY. Canadian long-code A2P is vetted through the
// same registry as the US by some providers. It sits in the non-registry shape
// because the generic wording is true either way, where a US-shaped tile would
// ask a Toronto studio for fields they may not need. Worth confirming against a
// live Canadian account rather than more searching.

import { normaliseCountry } from './business-identifiers.ts';

export type RegistryKind = 'us_10dlc' | 'none';

export interface SmsFieldOption {
  value: string;
  label: string;
}

export interface SmsField {
  key: string;
  label: string;
  type: 'url' | 'text' | 'textarea' | 'select';
  placeholder?: string;
  hint?: string;
  options?: SmsFieldOption[];
  /** Which sample message pre-fills this field on first open. */
  template?: 'sample_1' | 'sample_2';
  /** The written-out pre-fill, added by smsTileFor once the studio name is known. */
  defaultValue?: string;
}

export interface SmsRegistration {
  registry: RegistryKind;
  // INVARIANT: `stepsDfy` and `stepsGuided` are rendered as RAW HTML by
  // account.html, because they carry <em>. Everything else on this object goes
  // through esc(). Nothing studio-supplied may ever reach a step string. The one
  // studio-derived value here is the studio name, and it only reaches
  // `defaultValue`, which is escaped at both of its sinks.
  whatWeDo: string;
  whatYouNeedForGuided: string;
  stepsDfy: string[];
  stepsGuided: string[];
  fields: SmsField[];
  noAccountLabel: string;
}

/** Countries whose networks put us through a campaign registry we must file with. */
const REGISTRY_BY_COUNTRY: Record<string, RegistryKind> = {
  US: 'us_10dlc',
};

export function registryFor(country: string | null | undefined): RegistryKind {
  return REGISTRY_BY_COUNTRY[normaliseCountry(country)] ?? 'none';
}

/**
 * US English for US studios, Australian English for everyone else. Matches the
 * onboarding form's rule: US English is the fallback for country-blind surfaces,
 * never an override on a country-aware one, and this one is country-aware.
 */
function enrolments(country: string | null | undefined): string {
  return normaliseCountry(country) === 'US' ? 'enrollments' : 'enrolments';
}

/**
 * The two pre-filled sample messages.
 *
 * STOP is the opt-out keyword every one of these markets understands, so it is
 * in both. HELP is a US carrier requirement specifically, so it only appears
 * where a carrier is going to check for it.
 */
export function sampleSmsFor(
  country: string | null | undefined,
  studioName: string,
): { sample_sms_1: string; sample_sms_2: string } {
  const name = String(studioName || '').trim() || 'Your Studio';
  const optOut = registryFor(country) === 'us_10dlc'
    ? 'Reply STOP to opt out, HELP for support.'
    : 'Reply STOP to opt out.';
  return {
    sample_sms_1:
      `${name}: Hi {first_name}, this is a reminder about your class on {date} at {time}. ${optOut}`,
    sample_sms_2:
      `${name}: Term ${enrolments(country)} open today! Browse classes and book your spot: {link}. ${optOut}`,
  };
}

// ── Fields ──────────────────────────────────────────────────────────────────
//
// The universal set is what WE need to set a studio up to send, anywhere. The
// registry set on top of it is US Campaign Registry machinery and is asked for
// nowhere else.

function universalFields(country: string | null | undefined): SmsField[] {
  const carrierAudience = registryFor(country) === 'us_10dlc'
    ? 'The carriers want a clear plain-English description of how consent is captured.'
    : 'A clear plain-English description of how consent is captured, in your own words.';
  const varietyHint = registryFor(country) === 'us_10dlc'
    ? 'A different use case, so the carriers see your message variety.'
    : 'A different use case, so we can see the range of what you send.';
  return [
    {
      key: 'privacy_policy_url',
      label: 'Privacy Policy URL',
      type: 'url',
      placeholder: 'https://yourstudio.com/privacy',
      hint: 'Must say how you handle SMS data. Leave blank if you do not have one yet and we will send you a template.',
    },
    {
      key: 'terms_url',
      label: 'Terms of Service URL',
      type: 'url',
      placeholder: 'https://yourstudio.com/terms',
      hint: 'Must cover message frequency and how families stop receiving messages. Leave blank if missing.',
    },
    {
      key: 'business_description',
      label: 'One-sentence business description',
      type: 'textarea',
      placeholder: 'e.g. Dance studio running term-based classes and casual workshops for ages 4 to adult.',
      hint: '1-2 sentences. Used for your sender registration and WhatsApp Business setup.',
    },
    {
      key: 'opt_in_method',
      label: 'How do families opt in to your SMS?',
      type: 'select',
      options: [
        { value: '', label: 'Select…' },
        { value: 'web_form', label: 'Web form / online enrolment' },
        { value: 'paper', label: 'Paper form at enrolment' },
        { value: 'verbal', label: 'Verbal consent at front desk' },
        { value: 'multiple', label: 'Multiple methods' },
      ],
    },
    {
      key: 'opt_in_description',
      label: 'Describe your opt-in in plain English',
      type: 'textarea',
      placeholder: 'e.g. Families tick a "Receive class reminders" checkbox on our online enrolment form. The checkbox is unchecked by default.',
      hint: carrierAudience,
    },
    {
      key: 'sample_sms_1',
      label: 'Sample SMS 1 (pre-filled, edit as needed)',
      type: 'textarea',
      hint: 'Must include your studio name and "Reply STOP to opt out".',
      template: 'sample_1',
    },
    {
      key: 'sample_sms_2',
      label: 'Sample SMS 2 (pre-filled, edit as needed)',
      type: 'textarea',
      hint: varietyHint,
      template: 'sample_2',
    },
  ];
}

/** US Campaign Registry only. Asked for nowhere else, because nowhere else asks us. */
const REGISTRY_FIELDS: SmsField[] = [
  {
    key: 'industry_vertical',
    label: 'Industry vertical',
    type: 'select',
    hint: 'The registry makes you pick one. Education fits most dance and music schools.',
    options: [
      { value: '', label: 'Select…' },
      { value: 'education', label: 'Education (most dance/music studios)' },
      { value: 'professional_services', label: 'Professional Services' },
      { value: 'recreation', label: 'Recreation & Entertainment' },
      { value: 'fitness', label: 'Fitness & Wellness' },
      { value: 'retail', label: 'Retail' },
      { value: 'other', label: 'Other' },
    ],
  },
  {
    key: 'estimated_monthly_volume',
    label: 'Estimated monthly SMS volume',
    type: 'select',
    hint: 'Sets your throughput tier with the carriers. A rough number is fine.',
    options: [
      { value: '', label: 'Select…' },
      { value: 'lt_1k', label: 'Under 1,000' },
      { value: '1k_10k', label: '1,000 – 10,000' },
      { value: '10k_100k', label: '10,000 – 100,000' },
      { value: '100k_plus', label: 'Over 100,000' },
    ],
  },
  {
    key: 'opt_in_screenshot_url',
    label: 'Opt-in screenshot URL (optional)',
    type: 'url',
    placeholder: 'https://...',
    hint: 'Helpful for Toll-Free verification. Screenshot your enrolment opt-in checkbox, put it somewhere shareable, and paste the link, or send it via Messages.',
  },
];

const NOTES_FIELD: SmsField = {
  key: 'notes',
  label: 'Anything else? (optional)',
  type: 'textarea',
  placeholder: 'e.g. We already had a messaging provider set up by a previous developer.',
};

const US: Omit<SmsRegistration, 'fields'> = {
  registry: 'us_10dlc',
  whatWeDo:
    'We register your business with the US 10DLC carrier registry so your automations can text families from your own number, and we do the filing for you. The carriers review it, which is why this asks for more than the other tiles: your business identity, how families agreed to hear from you, and the kind of messages you will send. It is the most regulated part of the setup.',
  whatYouNeedForGuided:
    'Your privacy policy and terms of service on your website, both mentioning SMS data handling and STOP/HELP, one or two sample messages, and a brief description of how you collect consent to text families.',
  stepsDfy: [
    'Make sure your website has a Privacy Policy and Terms of Service. They must mention how you handle SMS data and include STOP/HELP language. <em>If you do not have these, leave the URLs blank and we will send you compliant templates after submission.</em>',
    'Pick an industry vertical that matches your studio (Education is the closest fit for most dance and music schools).',
    'Tell us how families opt in to receive SMS from you (web form at enrolment, paper form, verbal, and so on).',
    'Review the two pre-filled sample messages below. Edit the wording if you like, but keep the studio name and the STOP line.',
    'Submit and we will handle the registration. Carrier approval usually takes 3-7 business days.',
  ],
  stepsGuided: [
    'Publish a Privacy Policy and Terms of Service on your website. Both must mention SMS data handling and STOP/HELP.',
    'Inside StudioLAB Growth, go to Settings → Phone Numbers → A2P Registration and submit your business identity. We send you a guide once you reach this step.',
    'Use compliant sample messages. The pre-fill below shows the safe pattern.',
    'After the carriers approve, typically 3-7 business days, your sending limits unlock.',
  ],
  noAccountLabel: 'I do not have a Privacy Policy or Terms yet, please help me set them up.',
};

const REST_OF_WORLD: Omit<SmsRegistration, 'fields'> = {
  registry: 'none',
  whatWeDo:
    'We set your automations up to text families from your studio\'s own number, one they can reply to, and we handle whatever registration your network asks for. What matters everywhere is the same three things: families agreed to hear from you, every message says who it is from, and stopping them works first time. That is what the details below capture.',
  whatYouNeedForGuided:
    'Your privacy policy and terms of service on your website, both mentioning how you handle SMS data and how families stop receiving messages, one or two sample messages, and a brief description of how you collect consent to text families.',
  stepsDfy: [
    'Make sure your website has a Privacy Policy and Terms of Service. Both should say how you handle SMS data and how families stop receiving messages. <em>If you do not have these, leave the URLs blank and we will send you templates after submission.</em>',
    'Tell us how families opt in to receive texts from you (web form at enrolment, paper form, verbal, and so on).',
    'Review the two pre-filled sample messages below. Edit the wording if you like, but keep the studio name and the STOP line.',
    'Submit, and we will get your number set up to send.',
  ],
  stepsGuided: [
    'Publish a Privacy Policy and Terms of Service on your website. Both should cover SMS data handling and how families opt out.',
    'Inside StudioLAB Growth, go to Settings → Phone Numbers and connect the number you want to text from. We send you a guide once you reach this step.',
    'Keep your studio name and a working STOP instruction in every campaign. The pre-fill below shows the safe pattern.',
    'Send yourself a test, reply STOP, and check it takes effect before you message families.',
  ],
  noAccountLabel: 'I do not have a Privacy Policy or Terms yet, please help me set them up.',
};

/**
 * The tile as the studio's browser receives it, with the sample messages already
 * written out.
 *
 * Resolved on the SERVER and sent down with the account payload, deliberately.
 * account.html cannot import this module (it is a plain page with an inline
 * script and there is no bundler), so the alternative was a hand-kept copy of
 * all this copy in the browser held together by a drift test. The account page
 * always fetches before it renders anything and a studio's country cannot change
 * while they are looking at the page, so there is nothing the client needs to
 * decide. One definition, no mirror.
 *
 * KNOWN, ACCEPTED LIMIT. The studio name is baked in here, so a studio who
 * renames themselves in the self-edit card and then opens this tile for the
 * first time in the same session sees the old name in the two pre-filled sample
 * messages. They are editable text in a field they are being asked to review,
 * and a reload fixes it. Not worth refetching the whole account on every
 * profile save to avoid.
 */
export function smsTileFor(
  country: string | null | undefined,
  studioName: string,
): SmsRegistration {
  const model = smsRegistrationFor(country);
  const samples = sampleSmsFor(country, studioName);
  return {
    ...model,
    fields: model.fields.map((f) => (
      f.template
        ? { ...f, defaultValue: f.template === 'sample_1' ? samples.sample_sms_1 : samples.sample_sms_2 }
        : f
    )),
  };
}

export function smsRegistrationFor(country: string | null | undefined): SmsRegistration {
  const base = registryFor(country) === 'us_10dlc' ? US : REST_OF_WORLD;
  const fields = registryFor(country) === 'us_10dlc'
    ? [...universalFields(country), ...REGISTRY_FIELDS, NOTES_FIELD]
    : [...universalFields(country), NOTES_FIELD];
  return { ...base, fields };
}

/**
 * Every key any country's tile can produce. This is what the save endpoint
 * allows, deliberately the UNION rather than a per-country check: a studio whose
 * country resolves differently between two visits must not have the work they
 * already submitted rejected at the door.
 */
export function smsFieldKeys(): string[] {
  const out = new Set<string>();
  for (const country of ['US', 'AU']) {
    smsRegistrationFor(country).fields.forEach((f) => out.add(f.key));
  }
  return Array.from(out);
}
