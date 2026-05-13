// Formats a paid submission's knowledge-base fields as a clean Markdown
// document ready to paste into the GHL Conversation AI knowledge base.
// Single output — no extra ceremony, no commentary, just the document.

interface KbExportInput {
  studioName: string;
  legalName: string | null;
  websiteUrl: string | null;
  greeting: string | null;
  profile: string | null;
  classes: string | null;
  pricing: string | null;
  priceQuoting: string | null;
  policies: string | null;
  events: string | null;
  faqs: string | null;
  tone: string | null;
  voiceHours: string | null;
  voiceEscalate: string | null;
  restricted: string | null;
  personaType: 'studio' | 'named' | null;
  personaName: string | null;
}

function section(title: string, body: string | null | undefined): string {
  const trimmed = (body || '').trim();
  if (!trimmed) return '';
  return `## ${title}\n\n${trimmed}\n`;
}

export function buildKbMarkdown(input: KbExportInput): string {
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [];

  out.push(`# Knowledge base — ${input.studioName}`);
  out.push('');
  if (input.legalName && input.legalName !== input.studioName) {
    out.push(`*Legal entity:* ${input.legalName}`);
  }
  if (input.websiteUrl) out.push(`*Website:* ${input.websiteUrl}`);
  out.push(`*Last updated:* ${today}`);
  out.push('');

  // Assistant persona — load-bearing instruction for the AI, sits up top.
  const personaLine = input.personaType === 'named' && input.personaName
    ? `Introduce yourself as **${input.personaName}**, the AI assistant for ${input.studioName}.`
    : `Introduce yourself as the AI assistant for ${input.studioName}.`;
  out.push(section('Assistant persona', personaLine));

  out.push(section('Opening greeting', input.greeting));
  out.push(section('Voice and tone', input.tone));
  out.push(section('Studio profile', input.profile));
  out.push(section('Classes and dress code', input.classes));
  out.push(section('Policies', input.policies));
  out.push(section('Pricing and packages', input.pricing));

  // The price-quoting guardrail is one of the most important blocks. Pin it
  // under its own heading so the AI cannot miss it during retrieval.
  if (input.priceQuoting) {
    out.push(section('Pricing — strict guardrail (do not skip)', input.priceQuoting));
  }

  out.push(section('Concerts and events', input.events));
  out.push(section('FAQs and other information', input.faqs));

  if (input.voiceHours) out.push(section('Office hours (for voice agent)', input.voiceHours));
  if (input.voiceEscalate) out.push(section('When to escalate to a human', input.voiceEscalate));
  if (input.restricted) out.push(section('Restricted information — do not share', input.restricted));

  return out.filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
