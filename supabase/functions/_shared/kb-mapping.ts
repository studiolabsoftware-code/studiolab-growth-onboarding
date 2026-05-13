// Maps a coerced KbExtraction (plus default fallbacks) onto the existing
// kb_* free-text columns on submissions. Single responsibility: produce an
// update object plus a per-field "source" map ("website" or "default") for
// the scrape_sources column. Nothing in here touches the database.

import { coerceExtraction, type KbExtraction } from './kb-prompt.ts';
import {
  TRIAL_DRESS_CODE_DEFAULT,
  CANCELLATION_POLICY_DEFAULT,
  REFUND_POLICY_DEFAULT,
  BEHAVIOUR_POLICY_DEFAULT,
  CONCERT_OVERVIEW_DEFAULT,
  COSTUME_INFO_DEFAULT,
  BILLING_NOTES_DEFAULT,
  PRICE_QUOTING_GUARDRAIL,
  TONE_DEFAULT,
  defaultGreeting,
  dressCodeFor,
} from './kb-defaults.ts';

export interface MappingInput {
  studioName: string | null;
  personaType: 'studio' | 'named' | null;
  personaName: string | null;
  rawExtraction?: unknown;     // The parsed JSON from Claude, or undefined.
  preserveEdited?: Record<string, 'website' | 'default' | 'edited'> | null;
  // Existing kb_* values from the row — kept verbatim for any field whose
  // current source is 'edited' so the studio's manual edits survive a
  // second run (used by add-website-and-scrape).
  existing?: Partial<KbFields> | null;
}

export interface KbFields {
  kb_greeting: string;
  kb_profile: string;
  kb_classes: string;
  kb_pricing: string;
  kb_price_quoting: string;
  kb_policies: string;
  kb_events: string;
  kb_faqs: string;
  kb_tone: string;
  voice_hours: string | null;
}

export interface MappingResult {
  fields: KbFields;
  sources: Record<keyof KbFields, 'website' | 'default'>;
  extraction: KbExtraction;
}

function joinSections(sections: Array<{ heading?: string | null; body: string | null | undefined }>): string {
  const out: string[] = [];
  for (const s of sections) {
    const body = (s.body || '').trim();
    if (!body) continue;
    if (s.heading) out.push(`${s.heading}\n${body}`);
    else out.push(body);
  }
  return out.join('\n\n');
}

export function buildKbFields(input: MappingInput): MappingResult {
  const extraction = coerceExtraction(input.rawExtraction);
  const studioName = (input.studioName || 'the studio').trim();
  const personaType = (input.personaType === 'named') ? 'named' : 'studio';

  // ---- Greeting ----
  const greeting = defaultGreeting({
    studioName,
    personaType,
    personaName: input.personaName,
  });

  // ---- kb_profile: who they are + hours + disciplines ----
  const profileWebsite = !!(extraction.studioOverview || extraction.operatingHours || extraction.disciplines);
  const profileSections: Array<{ heading?: string; body: string | null }> = [];
  if (extraction.studioOverview) {
    profileSections.push({ body: extraction.studioOverview });
  } else {
    profileSections.push({ body: `${studioName} is a dance studio teaching a range of disciplines for all ages and abilities.` });
  }
  if (extraction.disciplines && extraction.disciplines.length) {
    profileSections.push({ heading: 'What we teach:', body: extraction.disciplines.join(', ') });
  }
  if (extraction.operatingHours) {
    profileSections.push({ heading: 'Studio / office hours:', body: extraction.operatingHours });
  }
  const kb_profile = joinSections(profileSections);

  // ---- kb_classes: per-discipline dress code + trial info ----
  const classesWebsite = !!(extraction.dressCodes || extraction.trialInfo);
  const classesSections: Array<{ heading?: string; body: string | null }> = [];
  classesSections.push({
    heading: 'First class / trial — what to wear:',
    body: extraction.trialInfo || TRIAL_DRESS_CODE_DEFAULT,
  });
  // Build a dress-code block. Use Claude's per-discipline list when present;
  // otherwise fall back to the discipline list + per-discipline defaults.
  const dressCodeLines: string[] = [];
  if (extraction.dressCodes && extraction.dressCodes.length) {
    for (const dc of extraction.dressCodes) {
      dressCodeLines.push(`${dc.discipline}: ${dc.description}`);
    }
  } else if (extraction.disciplines && extraction.disciplines.length) {
    for (const d of extraction.disciplines) {
      const def = dressCodeFor(d);
      if (def) dressCodeLines.push(`${d}: ${def}`);
    }
  }
  if (dressCodeLines.length) {
    classesSections.push({ heading: 'Dress code by discipline:', body: dressCodeLines.join('\n') });
  }
  const kb_classes = joinSections(classesSections);

  // ---- kb_pricing: packages + billing notes ----
  const pricingWebsite = !!(extraction.packages || extraction.billingInfo);
  const pricingSections: Array<{ heading?: string; body: string | null }> = [];
  if (extraction.packages && extraction.packages.length) {
    const pkgLines = extraction.packages.map((p) => {
      const cond = p.conditions ? `\n  Conditions: ${p.conditions}` : '';
      return `${p.name}: ${p.description}${cond}`;
    }).join('\n\n');
    pricingSections.push({ heading: 'Packages and discounts:', body: pkgLines });
  }
  pricingSections.push({
    heading: 'Billing:',
    body: extraction.billingInfo || BILLING_NOTES_DEFAULT,
  });
  const kb_pricing = joinSections(pricingSections);

  // ---- kb_price_quoting: hard guardrail for the AI ----
  const kb_price_quoting = PRICE_QUOTING_GUARDRAIL;

  // ---- kb_policies: cancellation + refund + behaviour ----
  const policiesWebsite = !!(extraction.cancellationPolicy || extraction.refundPolicy || extraction.behaviourPolicy);
  const policiesSections: Array<{ heading?: string; body: string | null }> = [
    {
      heading: 'Cancellations and makeup classes:',
      body: extraction.cancellationPolicy || CANCELLATION_POLICY_DEFAULT,
    },
    {
      heading: 'Refunds:',
      body: extraction.refundPolicy || REFUND_POLICY_DEFAULT,
    },
    {
      heading: 'Behaviour and conduct:',
      body: extraction.behaviourPolicy || BEHAVIOUR_POLICY_DEFAULT,
    },
  ];
  const kb_policies = joinSections(policiesSections);

  // ---- kb_events: concert + costumes ----
  const eventsWebsite = !!(extraction.concertOverview || extraction.costumeInfo);
  const eventsSections: Array<{ heading?: string; body: string | null }> = [
    { heading: 'Annual concert:', body: extraction.concertOverview || CONCERT_OVERVIEW_DEFAULT },
    { heading: 'Costumes:', body: extraction.costumeInfo || COSTUME_INFO_DEFAULT },
  ];
  const kb_events = joinSections(eventsSections);

  // ---- kb_faqs: trial info + other info + parking/transport ----
  const faqsWebsite = !!(extraction.otherInfo || extraction.parkingInfo || extraction.publicTransport);
  const faqsSections: Array<{ heading?: string; body: string | null }> = [];
  if (extraction.otherInfo) faqsSections.push({ heading: 'General FAQ:', body: extraction.otherInfo });
  if (extraction.parkingInfo) faqsSections.push({ heading: 'Parking:', body: extraction.parkingInfo });
  if (extraction.publicTransport) faqsSections.push({ heading: 'Public transport:', body: extraction.publicTransport });
  const kb_faqs = joinSections(faqsSections);

  // ---- kb_tone (always default — tone is a studio preference, not website data) ----
  const kb_tone = TONE_DEFAULT;

  // ---- voice_hours (when the office is open) ----
  const voice_hours = extraction.operatingHours;

  const fields: KbFields = {
    kb_greeting: greeting,
    kb_profile,
    kb_classes,
    kb_pricing,
    kb_price_quoting,
    kb_policies,
    kb_events,
    kb_faqs,
    kb_tone,
    voice_hours,
  };

  const sources: Record<keyof KbFields, 'website' | 'default'> = {
    kb_greeting: 'default',
    kb_profile: profileWebsite ? 'website' : 'default',
    kb_classes: classesWebsite ? 'website' : 'default',
    kb_pricing: pricingWebsite ? 'website' : 'default',
    kb_price_quoting: 'default',
    kb_policies: policiesWebsite ? 'website' : 'default',
    kb_events: eventsWebsite ? 'website' : 'default',
    kb_faqs: faqsWebsite ? 'website' : 'default',
    kb_tone: 'default',
    voice_hours: extraction.operatingHours ? 'website' : 'default',
  };

  // Preserve studio-edited values across a re-run.
  if (input.preserveEdited && input.existing) {
    for (const k of Object.keys(fields) as Array<keyof KbFields>) {
      if (input.preserveEdited[k] === 'edited' && input.existing[k] != null) {
        (fields as Record<string, unknown>)[k] = input.existing[k]!;
        sources[k] = 'default'; // source map doesn't carry 'edited' — that lives in scrape_sources separately
      }
    }
  }

  return { fields, sources, extraction };
}
