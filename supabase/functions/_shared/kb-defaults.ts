// Smart defaults for the knowledge-base intake. These are used whenever the
// website scrape returns null for a field, and as the initial value when no
// website was provided at all. Written to be accurate for the majority of
// dance studios — studios with stricter or more generous policies edit them.
//
// Source: Growth-Onboarding-Scrape-Module-Brief.md §8.

export const DRESS_CODE_DEFAULTS: Record<string, string> = {
  ballet: 'Leotard, tights, and ballet shoes. Hair tied back neatly.',
  jazz: 'Fitted top or leotard, jazz pants or leggings, and jazz shoes. Hair tied back.',
  'hip hop': 'Comfortable activewear and clean sneakers.',
  hiphop: 'Comfortable activewear and clean sneakers.',
  'hip-hop': 'Comfortable activewear and clean sneakers.',
  contemporary: 'Fitted top and leggings. Bare feet or foot undies. Hair secured.',
  lyrical: 'Fitted top and leggings. Bare feet or foot undies. Hair secured.',
  tap: 'Fitted top, pants or leggings, and tap shoes.',
  acro: 'Fitted top and shorts or bike shorts. Bare feet. Hair tied back securely.',
  acrobatics: 'Fitted top and shorts or bike shorts. Bare feet. Hair tied back securely.',
  'musical theatre': 'Fitted top and jazz pants or leggings. Jazz shoes. Hair off face.',
  musicaltheatre: 'Fitted top and jazz pants or leggings. Jazz shoes. Hair off face.',
  pointe: 'As per ballet with pointe shoes. Students must have instructor approval for pointe work.',
  preschool: 'Leotard or comfortable clothing they can move in. Ballet shoes if available, otherwise bare feet.',
  kinderdance: 'Leotard or comfortable clothing they can move in. Ballet shoes if available, otherwise bare feet.',
};

export const TRIAL_DRESS_CODE_DEFAULT =
  "For your first class, wear something comfortable that's easy to move in. " +
  "Your teacher will let you know if anything specific is needed for future classes.";

export const CANCELLATION_POLICY_DEFAULT =
  "If your child is unable to attend a class, please let us know. Makeup classes may be " +
  "available in the same discipline, subject to availability. Contact the studio to arrange.";

export const REFUND_POLICY_DEFAULT =
  "Refunds may be available within the first two weeks of the billing period. After that, " +
  "credit may be applied to a future period at the studio's discretion. Contact the studio " +
  "directly for refund requests.";

export const BEHAVIOUR_POLICY_DEFAULT =
  "We expect all students to be respectful of their teachers and fellow students. The studio " +
  "reserves the right to address any behavioural concerns with families directly.";

export const CONCERT_OVERVIEW_DEFAULT =
  "Our annual concert is held towards the end of the year. Every class has the opportunity " +
  "to perform. Dates and venue details are shared closer to the time.";

export const COSTUME_INFO_DEFAULT =
  "Costume fees are billed separately and vary by routine. The studio handles ordering and fitting.";

export const BILLING_NOTES_DEFAULT =
  "Fees are charged at the start of each billing period. A valid payment method is required on your account.";

export const PRICE_QUOTING_GUARDRAIL =
  "Do not calculate combined pricing, apply discounts directly, or generate totals for " +
  "multi-class scenarios. Describe what is available and direct parents to the portal " +
  "for exact pricing.";

export const TONE_DEFAULT =
  "Friendly, warm, and concise. Use plain English. Speak like a knowledgeable studio " +
  "receptionist — confident, helpful, and never robotic. Never invent details about " +
  "the studio that are not in this knowledge base; if something is unknown, offer to " +
  "pass the enquiry on to the team.";

// =============================================================================
// Greeting generator (driven by persona choice)
// =============================================================================
export function defaultGreeting(opts: {
  studioName: string;
  personaType: 'studio' | 'named';
  personaName: string | null;
}): string {
  const studio = (opts.studioName || 'the studio').trim();
  if (opts.personaType === 'named' && opts.personaName && opts.personaName.trim()) {
    const name = opts.personaName.trim();
    return `Hi, I'm ${name}, the AI assistant for ${studio}. I can help you find a class, answer your questions, or help you get started. What can I help with?`;
  }
  return `Hi! Welcome to ${studio}. I can help you find a class, answer your questions, or help you get started. What can I help with?`;
}

// =============================================================================
// Discipline matching for dress-code defaults
// =============================================================================
// Fuzzy match a discipline name to a default by normalising punctuation /
// whitespace / casing. Returns null when the discipline has no canonical
// default — the studio fills the dress code in by hand for those.
export function dressCodeFor(discipline: string): string | null {
  if (!discipline) return null;
  const key = discipline.toLowerCase().replace(/[^a-z\s-]/g, '').trim();
  if (DRESS_CODE_DEFAULTS[key]) return DRESS_CODE_DEFAULTS[key];
  // Try a no-space variant ("hiphop") and a hyphen variant ("hip-hop").
  const noSpace = key.replace(/\s+/g, '');
  if (DRESS_CODE_DEFAULTS[noSpace]) return DRESS_CODE_DEFAULTS[noSpace];
  const hyphenated = key.replace(/\s+/g, '-');
  if (DRESS_CODE_DEFAULTS[hyphenated]) return DRESS_CODE_DEFAULTS[hyphenated];
  return null;
}
