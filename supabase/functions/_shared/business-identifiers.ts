// Which business identifier does a studio in THIS country actually have?
//
// WHY THIS EXISTS. The form asked for exactly three things: EIN if the country
// was US and the business was not a sole proprietor, ABN if the country was AU,
// and ACN as well if it was a Pty Ltd. Every other country got asked for
// NOTHING, because the gating was written against the two commercial lines
// (Australia and everyone else) rather than against the studio's actual country.
//
// That matters beyond tidiness. Standard A2P brand registration requires a tax
// ID, and the registry wants the one that country issues: EIN in the US, a
// company number in the UK and Australia, a BN in Canada. A New Zealand studio
// who reaches SMS registration with no identifier on file cannot be registered
// at all, and nothing in the flow would have told us until it failed.
//
// The commercial line and the content locale are two different axes. A UK studio
// pays on the everyone-else line in USD AND is a UK business asked for a UK
// company number. Nothing here should ever be keyed on the AU/US pricing split.

/** The identifier keys we store. `tax_id` is the generic fallback. */
export type IdentifierKey = 'abn' | 'acn' | 'ein' | 'nzbn' | 'crn' | 'bn' | 'tax_id';

export interface IdentifierSpec {
  key: IdentifierKey;
  /** Studio-facing label. Uses the name the country actually uses. */
  label: string;
  hint: string;
  /** Expected digit count where the country has a fixed one. Advisory, not a hard block. */
  digits?: number;
  /**
   * 'all'          every business in this country holds one
   * 'incorporated' only companies hold one (a sole trader will not)
   */
  appliesTo: 'all' | 'incorporated';
}

/**
 * Business types that are incorporated entities. A sole trader or partnership is
 * not, which is why an Australian sole trader has an ABN but no ACN, and a UK
 * sole trader has no company number at all.
 */
const INCORPORATED = new Set(['llc', 'corp', 'pty_ltd', 'ltd', 'llp', 'nonprofit']);

const ABN: IdentifierSpec = {
  key: 'abn',
  label: 'ABN',
  hint: 'Australian Business Number, 11 digits. Every Australian business has one, including sole traders.',
  digits: 11,
  appliesTo: 'all',
};

const ACN: IdentifierSpec = {
  key: 'acn',
  label: 'ACN',
  hint: 'Australian Company Number, 9 digits. Companies only, so leave it blank if you do not have one.',
  digits: 9,
  appliesTo: 'incorporated',
};

const EIN: IdentifierSpec = {
  key: 'ein',
  label: 'EIN',
  hint: 'Employer Identification Number, 9 digits. Must match your IRS filings exactly or SMS registration is refused.',
  digits: 9,
  appliesTo: 'incorporated',
};

const NZBN: IdentifierSpec = {
  key: 'nzbn',
  label: 'NZBN',
  hint: 'New Zealand Business Number, 13 digits. Every New Zealand business can have one, including sole traders.',
  digits: 13,
  appliesTo: 'all',
};

const CRN: IdentifierSpec = {
  key: 'crn',
  label: 'Company registration number',
  hint: 'Your Companies House number, 8 characters. Companies and LLPs only, so leave blank if you are a sole trader.',
  appliesTo: 'incorporated',
};

const BN: IdentifierSpec = {
  key: 'bn',
  label: 'Business Number (BN)',
  hint: 'Your CRA Business Number, 9 digits.',
  digits: 9,
  appliesTo: 'all',
};

const GENERIC: IdentifierSpec = {
  key: 'tax_id',
  label: 'Business registration or tax number',
  hint: 'Whatever your country issues to identify a registered business. Needed before we can register SMS on your behalf.',
  appliesTo: 'all',
};

/** Country code (as we store it) to the identifiers that country issues. */
const BY_COUNTRY: Record<string, IdentifierSpec[]> = {
  AU: [ABN, ACN],
  US: [EIN],
  NZ: [NZBN],
  UK: [CRN],
  GB: [CRN],
  CA: [BN],
};

/** Normalise the country values this system stores, including free text. */
export function normaliseCountry(country: string | null | undefined): string {
  const c = String(country ?? '').trim().toUpperCase();
  if (!c) return '';
  if (c === 'AU' || c === 'AUS' || c === 'AUSTRALIA') return 'AU';
  if (c === 'US' || c === 'USA' || c === 'AMERICA' || c === 'UNITED STATES') return 'US';
  if (c === 'NZ' || c === 'NZL' || c === 'NEW ZEALAND') return 'NZ';
  if (c === 'UK' || c === 'GB' || c === 'GBR' || c === 'UNITED KINGDOM' || c === 'GREAT BRITAIN') return 'UK';
  if (c === 'CA' || c === 'CAN' || c === 'CANADA') return 'CA';
  return c;
}

/**
 * The identifiers to ask a studio for, given their country and business type.
 *
 * An unknown country returns the generic field rather than nothing: asking a
 * studio in Ireland or Singapore for "your business registration number" is
 * imperfect, but it is far better than the current behaviour of asking them for
 * nothing and discovering the hole at SMS registration.
 *
 * `businessType` is optional. Before the studio picks one we return everything
 * that country issues, so the fields are visible rather than appearing later.
 */
export function identifiersFor(
  country: string | null | undefined,
  businessType?: string | null,
): IdentifierSpec[] {
  const specs = BY_COUNTRY[normaliseCountry(country)] ?? [GENERIC];
  const bt = String(businessType ?? '').trim().toLowerCase();
  if (!bt) return specs;
  const incorporated = INCORPORATED.has(bt);
  return specs.filter((s) => s.appliesTo === 'all' || incorporated);
}

/**
 * Does this studio have any identifier we can put to a Standard A2P brand
 * registration? False means the SMS path will stall, and for a US sole trader
 * that is expected: they register as a Sole Proprietor brand instead, which
 * takes no tax ID at all.
 */
export function hasRegisterableIdentifier(
  country: string | null | undefined,
  businessType?: string | null,
): boolean {
  return identifiersFor(country, businessType).length > 0;
}

/** Digits only, for comparing what a studio typed against the expected length. */
export function identifierDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * A shape check, deliberately advisory. It returns a message to show, never a
 * hard block: a studio mistyping their ABN should be nudged, not stopped from
 * paying us. The registry does the real validation.
 */
export function identifierShapeWarning(spec: IdentifierSpec, value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (!spec.digits) return null;
  const d = identifierDigits(raw);
  if (d.length === spec.digits) return null;
  return `${spec.label} is usually ${spec.digits} digits. Yours has ${d.length}. Worth double checking, since SMS registration is refused on a mismatch.`;
}

// ── Entity types ────────────────────────────────────────────────────────────
//
// Same defect, one field over. The business-type list was a single mixed AU/US
// menu, so an Australian studio was offered LLC and Corporation (neither of
// which exists here) and a UK studio picked from six options none of which fit
// their company. business_type feeds invoices and carrier registration, so a
// wrong value there is a real one, not a cosmetic one.
//
// Values are STABLE and shared across countries; only the label and the
// availability move. `sole_prop` means the same thing in Auckland and Ohio even
// though one reads "Sole trader" and the other "Sole Proprietor". Never rename a
// value to suit a country: existing rows have to keep resolving, and
// `identifiersFor` keys off these values.

export interface BusinessTypeOption {
  value: string;
  label: string;
}

const BUSINESS_TYPES_BY_COUNTRY: Record<string, BusinessTypeOption[]> = {
  AU: [
    { value: 'sole_prop', label: 'Sole Trader' },
    { value: 'partnership', label: 'Partnership' },
    { value: 'pty_ltd', label: 'Pty Ltd (Australian company)' },
    { value: 'nonprofit', label: 'Incorporated association / not-for-profit' },
    { value: 'other_au', label: 'Other Australian entity' },
    { value: 'other', label: 'Other' },
  ],
  US: [
    { value: 'sole_prop', label: 'Sole Proprietor' },
    { value: 'llc', label: 'LLC' },
    { value: 'corp', label: 'Corporation' },
    { value: 'partnership', label: 'Partnership' },
    { value: 'nonprofit', label: 'Non-profit' },
    { value: 'other', label: 'Other' },
  ],
  NZ: [
    { value: 'sole_prop', label: 'Sole trader' },
    { value: 'partnership', label: 'Partnership' },
    { value: 'ltd', label: 'Limited company' },
    { value: 'nonprofit', label: 'Incorporated society / charitable trust' },
    { value: 'other', label: 'Other' },
  ],
  UK: [
    { value: 'sole_prop', label: 'Sole trader' },
    { value: 'partnership', label: 'Partnership' },
    { value: 'ltd', label: 'Private limited company (Ltd)' },
    { value: 'llp', label: 'Limited liability partnership (LLP)' },
    { value: 'nonprofit', label: 'Charity / community interest company' },
    { value: 'other', label: 'Other' },
  ],
  CA: [
    { value: 'sole_prop', label: 'Sole proprietorship' },
    { value: 'partnership', label: 'Partnership' },
    { value: 'corp', label: 'Corporation' },
    { value: 'nonprofit', label: 'Non-profit' },
    { value: 'other', label: 'Other' },
  ],
};

/**
 * The generic list, for a country we do not have a catalogue for. It stays
 * deliberately vague ("Company / corporation") rather than borrowing a US label,
 * because an Irish studio is not an LLC and telling them they are puts a wrong
 * value on their invoice.
 */
const GENERIC_BUSINESS_TYPES: BusinessTypeOption[] = [
  { value: 'sole_prop', label: 'Sole trader / sole proprietor' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'corp', label: 'Company / corporation' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'other', label: 'Other' },
];

/** The entity types that actually exist in this country, in that country's words. */
export function businessTypesFor(country: string | null | undefined): BusinessTypeOption[] {
  return BUSINESS_TYPES_BY_COUNTRY[normaliseCountry(country)] ?? GENERIC_BUSINESS_TYPES;
}

/**
 * The label to show for a stored value. Country-aware, so an Australian studio's
 * review step and the admin view both read "Sole Trader" rather than the US
 * "Sole Proprietor" for the same stored `sole_prop`.
 *
 * A value the country does not offer still resolves: a studio can move country
 * between drafts, and an old row must never render as a blank. We fall back to
 * any country's label for that value before giving up and showing the raw value.
 */
export function businessTypeLabelFor(country: string | null | undefined, value: string | null | undefined): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  const own = businessTypesFor(country).find((o) => o.value === v);
  if (own) return own.label;
  for (const list of Object.values(BUSINESS_TYPES_BY_COUNTRY)) {
    const hit = list.find((o) => o.value === v);
    if (hit) return hit.label;
  }
  const generic = GENERIC_BUSINESS_TYPES.find((o) => o.value === v);
  return generic ? generic.label : v;
}

/** Every value any country offers. The form's `<select>` must carry all of them. */
export function allBusinessTypeValues(): string[] {
  const out = new Set<string>();
  for (const list of Object.values(BUSINESS_TYPES_BY_COUNTRY)) list.forEach((o) => out.add(o.value));
  GENERIC_BUSINESS_TYPES.forEach((o) => out.add(o.value));
  return Array.from(out);
}

/**
 * Every country either catalogue names.
 *
 * Exists for the parity test, which drives its matrix off this rather than a
 * hand-written list. A hand-written list is the gap that lets someone add a
 * country here, forget the browser copy in js/form.js, and still go green.
 */
export function catalogueCountries(): string[] {
  const out = new Set<string>(Object.keys(BY_COUNTRY));
  Object.keys(BUSINESS_TYPES_BY_COUNTRY).forEach((c) => out.add(c));
  return Array.from(out);
}
