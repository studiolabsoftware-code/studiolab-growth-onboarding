// The Claude Haiku extraction prompt. Single source of truth — the
// scrape-and-extract function imports both halves and concatenates the
// crawled page content onto the user prompt at call time.

export const KB_EXTRACTION_SYSTEM_PROMPT = `You are a data extraction assistant for StudioLAB, a dance studio management platform. You are given text content crawled from a dance studio's website. Your job is to extract specific information and return it as structured JSON.

Rules:
- Only extract information that is clearly and explicitly stated on the website.
- Do not infer, guess, or fabricate information.
- If a field has no relevant content in the provided text, set it to null.
- For dress code, extract per-discipline requirements. If the website groups them or uses general statements, break them out by discipline where possible.
- For policies, extract the studio's actual policy wording. Keep it concise but preserve the meaning.
- For packages and discounts, extract the name, description, and any conditions or restrictions.
- Return valid JSON only. No markdown, no commentary, no explanation.`;

export const KB_EXTRACTION_USER_PROMPT_HEADER = `Extract the following fields from this dance studio's website content. Return a JSON object with exactly these keys. Use null for any field where the website does not provide relevant information.

{
  "studioOverview": "2 to 3 sentence description of the studio (who they are, what they teach, what makes them special)",
  "disciplines": ["list of dance styles/disciplines taught at this studio"],
  "dressCodes": [
    {
      "discipline": "discipline name",
      "description": "what to wear for this discipline"
    }
  ],
  "cancellationPolicy": "their policy on missed classes, cancellations, and makeup classes",
  "refundPolicy": "their refund or credit policy",
  "behaviourPolicy": "any behaviour expectations, rules, or code of conduct",
  "concertOverview": "information about their annual concert, recital, or end-of-year show",
  "costumeInfo": "how costume fees work, approximate costs, ordering process",
  "parkingInfo": "parking details, tips, or instructions",
  "publicTransport": "public transport information for getting to the studio",
  "operatingHours": "when the studio or office is open (not class times, office/admin hours)",
  "billingInfo": "how fees work, when payments are due, payment methods accepted",
  "packages": [
    {
      "name": "package or discount name",
      "description": "what the package includes or how the discount works",
      "conditions": "any conditions, restrictions, or eligibility requirements"
    }
  ],
  "trialInfo": "how trials work, cost of trials, what to expect at a trial class",
  "otherInfo": "any other information that would be useful for a parent enquiring about the studio (FAQ answers, unique features, notable policies)"
}

--- WEBSITE CONTENT ---

`;

export const KB_RETRY_USER_PROMPT =
  'Your previous response was not valid JSON. Please return only the JSON object, ' +
  'no markdown fences, no preamble, no commentary.';

// Shape of the JSON Claude returns. Every field nullable — null means
// "not found on the website" and triggers the default fallback.
export interface KbExtraction {
  studioOverview: string | null;
  disciplines: string[] | null;
  dressCodes: Array<{ discipline: string; description: string }> | null;
  cancellationPolicy: string | null;
  refundPolicy: string | null;
  behaviourPolicy: string | null;
  concertOverview: string | null;
  costumeInfo: string | null;
  parkingInfo: string | null;
  publicTransport: string | null;
  operatingHours: string | null;
  billingInfo: string | null;
  packages: Array<{ name: string; description: string; conditions: string | null }> | null;
  trialInfo: string | null;
  otherInfo: string | null;
}

// Validate / coerce an unknown JSON value into KbExtraction. Anything that
// fails type checks falls back to null so the defaults take over.
export function coerceExtraction(raw: unknown): KbExtraction {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    // Reject obvious junk and over-long values.
    if (trimmed.length < 4 || trimmed.length > 4000) return null;
    return trimmed;
  };
  const strArr = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null;
    const out = v.map((x) => str(x)).filter((x): x is string => !!x);
    return out.length ? out : null;
  };
  const dressArr = (v: unknown) => {
    if (!Array.isArray(v)) return null;
    const out = v.map((x) => {
      if (!x || typeof x !== 'object') return null;
      const o = x as Record<string, unknown>;
      const d = str(o.discipline);
      const desc = str(o.description);
      if (!d || !desc) return null;
      return { discipline: d, description: desc };
    }).filter((x): x is { discipline: string; description: string } => !!x);
    return out.length ? out : null;
  };
  const pkgArr = (v: unknown) => {
    if (!Array.isArray(v)) return null;
    const out = v.map((x) => {
      if (!x || typeof x !== 'object') return null;
      const o = x as Record<string, unknown>;
      const name = str(o.name);
      const desc = str(o.description);
      if (!name || !desc) return null;
      return { name, description: desc, conditions: str(o.conditions) };
    }).filter((x): x is { name: string; description: string; conditions: string | null } => !!x);
    return out.length ? out : null;
  };
  return {
    studioOverview: str(obj.studioOverview),
    disciplines: strArr(obj.disciplines),
    dressCodes: dressArr(obj.dressCodes),
    cancellationPolicy: str(obj.cancellationPolicy),
    refundPolicy: str(obj.refundPolicy),
    behaviourPolicy: str(obj.behaviourPolicy),
    concertOverview: str(obj.concertOverview),
    costumeInfo: str(obj.costumeInfo),
    parkingInfo: str(obj.parkingInfo),
    publicTransport: str(obj.publicTransport),
    operatingHours: str(obj.operatingHours),
    billingInfo: str(obj.billingInfo),
    packages: pkgArr(obj.packages),
    trialInfo: str(obj.trialInfo),
    otherInfo: str(obj.otherInfo),
  };
}
