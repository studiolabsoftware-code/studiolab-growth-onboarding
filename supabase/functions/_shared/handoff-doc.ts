// Generates a Word document (.docx) for a single submission, optimised for a
// VA to click-copy-paste each value into GHL. Each field renders as a bold
// label on its own line, the value on the next line, and a blank spacer line
// after — so triple-click selects just the value.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
} from 'https://esm.sh/docx@8.5.0';

interface Submission {
  id: string;
  plan?: string | null;
  setup_type?: string | null;
  studio_name?: string | null;
  legal_name?: string | null;
  country?: string | null;
  timezone?: string | null;
  studio_type?: string | null;
  address?: string | null;
  website?: string | null;
  support_url?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  role?: string | null;
  studiolab_email?: string | null;
  primary_colour?: string | null;
  secondary_colour?: string | null;
  sign_off?: string | null;
  email_tone?: string | null;
  footer_notes?: string | null;
  studio_description?: string | null;
  logo_url?: string | null;
  from_name?: string | null;
  reply_email?: string | null;
  custom_domain?: boolean | null;
  email_domain?: string | null;
  dns_access?: string | null;
  sms_type?: string | null;
  area_code?: string | null;
  port_number?: string | null;
  sms_tone?: string | null;
  lead_sources?: unknown;
  kb_profile?: string | null;
  kb_classes?: string | null;
  kb_pricing?: string | null;
  kb_price_quoting?: boolean | null;
  kb_policies?: string | null;
  kb_events?: string | null;
  kb_faqs?: unknown;
  kb_restricted?: string | null;
  kb_tone?: string | null;
  voice_hours?: string | null;
  voice_escalate?: string | null;
  extra_notes?: string | null;
  region?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // deno-lint-ignore no-explicit-any
  [k: string]: any;
}

interface DocOptions {
  assigneeName?: string;
  version?: number;
  isRevision?: boolean;
  changedFields?: string[];
  prevSentAt?: string | null;
}

const PLAN_LABEL: Record<string, string> = { launch: 'Launch', scale: 'Scale', ai: 'Dominate AI' };
const SETUP_LABEL: Record<string, string> = { dfy: 'Done-For-You', guided: 'Guided' };

function fmtBool(v: unknown): string {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return '';
}
function fmtList(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p.join(', ') : v; } catch { return v; }
  }
  return '';
}
function fmtFaqs(v: unknown): string {
  let arr = v;
  if (typeof v === 'string') {
    try { arr = JSON.parse(v); } catch { return v; }
  }
  if (!Array.isArray(arr) || !arr.length) return '';
  // deno-lint-ignore no-explicit-any
  return (arr as any[]).map((f) => `Q: ${f.q || f.question || ''}\nA: ${f.a || f.answer || ''}`).join('\n\n');
}

function val(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return fmtBool(v);
  return String(v);
}

interface FieldSpec {
  label: string;
  key: string;             // matches submissions column for change-tracking
  // deno-lint-ignore no-explicit-any
  get: (s: Submission) => string;
}

function field(label: string, key: keyof Submission): FieldSpec {
  return { label, key: String(key), get: (s) => val(s[key]) };
}
function fieldFn(label: string, key: string, get: (s: Submission) => string): FieldSpec {
  return { label, key, get };
}

interface Section {
  title: string;
  fields: FieldSpec[];
  showIf?: (s: Submission) => boolean;
}

function buildSections(sub: Submission): Section[] {
  const isScale = sub.plan === 'scale' || sub.plan === 'ai';
  const isAi = sub.plan === 'ai';

  const sections: Section[] = [
    {
      title: '1. Account Setup',
      fields: [
        field('Studio name', 'studio_name'),
        field('Legal business name', 'legal_name'),
        field('Country', 'country'),
        field('Time zone', 'timezone'),
        field('Studio type', 'studio_type'),
        field('Address', 'address'),
        field('Website', 'website'),
        field('Support URL', 'support_url'),
        field('StudioLAB login email', 'studiolab_email'),
      ],
    },
    {
      title: '2. Primary Contact',
      fields: [
        field('First name', 'first_name'),
        field('Last name', 'last_name'),
        field('Email', 'contact_email'),
        field('Phone', 'contact_phone'),
        field('Role', 'role'),
      ],
    },
    {
      title: '3. Branding',
      fields: [
        field('Logo URL', 'logo_url'),
        field('Primary colour (hex)', 'primary_colour'),
        field('Secondary colour (hex)', 'secondary_colour'),
        field('Sign-off', 'sign_off'),
        field('Email tone', 'email_tone'),
        field('Footer notes', 'footer_notes'),
        field('Studio description', 'studio_description'),
      ],
    },
    {
      title: '4. Email Configuration',
      fields: [
        field('From name', 'from_name'),
        field('Reply-to email', 'reply_email'),
        fieldFn('Custom domain', 'custom_domain', (s) => fmtBool(s.custom_domain)),
        field('Email domain', 'email_domain'),
        field('DNS access', 'dns_access'),
      ],
    },
  ];

  if (isScale) {
    sections.push({
      title: '5. SMS Configuration',
      fields: [
        field('Number preference', 'sms_type'),
        field('Area code', 'area_code'),
        field('Number to port', 'port_number'),
        field('SMS tone notes', 'sms_tone'),
        fieldFn('Lead sources', 'lead_sources', (s) => fmtList(s.lead_sources)),
      ],
    });
  }

  if (isAi) {
    sections.push({
      title: '6. AI Knowledge Base',
      fields: [
        field('Studio profile', 'kb_profile'),
        field('Classes & timetable', 'kb_classes'),
        field('Pricing', 'kb_pricing'),
        fieldFn('AI can quote prices', 'kb_price_quoting', (s) => fmtBool(s.kb_price_quoting)),
        field('Policies', 'kb_policies'),
        field('Events', 'kb_events'),
        fieldFn('FAQs', 'kb_faqs', (s) => fmtFaqs(s.kb_faqs)),
        field('Restricted topics', 'kb_restricted'),
        field('AI tone', 'kb_tone'),
        field('Voice agent hours', 'voice_hours'),
        field('Voice escalation', 'voice_escalate'),
      ],
    });
  }

  sections.push({
    title: '7. Notes',
    fields: [field('Additional notes', 'extra_notes')],
  });

  return sections;
}

function shortRef(id: string): string {
  return String(id || '').replace(/-/g, '').substring(0, 8).toUpperCase();
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Sydney' });
}

export async function buildHandoffDoc(sub: Submission, opts: DocOptions = {}): Promise<Uint8Array> {
  const changed = new Set(opts.changedFields || []);
  const sections = buildSections(sub);
  const planLabel = PLAN_LABEL[sub.plan || ''] || sub.plan || '—';
  const setupLabel = SETUP_LABEL[sub.setup_type || ''] || sub.setup_type || '—';

  const children: Paragraph[] = [];

  // Cover header
  children.push(new Paragraph({
    text: sub.studio_name || 'Studio handoff',
    heading: HeadingLevel.HEADING_1,
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: `Reference: ${shortRef(sub.id)}`, color: '666666' })],
  }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Plan: ', bold: true }),
      new TextRun({ text: planLabel }),
      new TextRun({ text: '    Setup: ', bold: true }),
      new TextRun({ text: setupLabel }),
      new TextRun({ text: '    Region: ', bold: true }),
      new TextRun({ text: (sub.region || '').toUpperCase() }),
    ],
  }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'Submitted: ', bold: true }),
      new TextRun({ text: fmtDate(sub.created_at) }),
      new TextRun({ text: '    Last updated: ', bold: true }),
      new TextRun({ text: fmtDate(sub.updated_at) }),
    ],
  }));
  if (opts.assigneeName) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: 'Assigned to: ', bold: true }),
        new TextRun({ text: opts.assigneeName }),
      ],
    }));
  }
  children.push(new Paragraph({ text: '' }));

  // Revision banner
  if (opts.isRevision) {
    children.push(new Paragraph({
      children: [new TextRun({
        text: 'UPDATED — please re-check the highlighted fields',
        bold: true, color: 'B45309',
      })],
    }));
    if (opts.prevSentAt) {
      children.push(new Paragraph({
        children: [new TextRun({
          text: `Previously sent: ${fmtDate(opts.prevSentAt)}`,
          color: '666666', italics: true,
        })],
      }));
    }
    if (opts.changedFields && opts.changedFields.length) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: 'Fields changed since last send: ', bold: true }),
          new TextRun({ text: opts.changedFields.join(', ') }),
        ],
      }));
    }
    children.push(new Paragraph({ text: '' }));
  }

  // Sections
  for (const section of sections) {
    if (section.showIf && !section.showIf(sub)) continue;
    children.push(new Paragraph({
      text: section.title,
      heading: HeadingLevel.HEADING_2,
    }));
    for (const f of section.fields) {
      const value = f.get(sub);
      const isChanged = changed.has(f.key);
      const labelText = isChanged ? `${f.label}  [UPDATED]` : f.label;
      children.push(new Paragraph({
        children: [new TextRun({
          text: labelText,
          bold: true,
          color: isChanged ? 'B45309' : '13102E',
        })],
      }));
      children.push(new Paragraph({
        children: [new TextRun({ text: value || '—', color: value ? '000000' : '999999' })],
      }));
      children.push(new Paragraph({ text: '' }));
    }
  }

  // Footer
  children.push(new Paragraph({
    children: [new TextRun({
      text: `Generated by StudioLAB Growth Admin · ${fmtDate(new Date().toISOString())}`,
      color: '999999', italics: true,
    })],
  }));

  const doc = new Document({
    creator: 'StudioLAB Growth',
    title: `Handoff — ${sub.studio_name || shortRef(sub.id)}`,
    description: 'Studio onboarding handoff for GHL implementation',
    sections: [{ children }],
  });

  return await Packer.toBuffer(doc) as unknown as Uint8Array;
}

export function handoffFilename(sub: Submission, version: number): string {
  const name = (sub.studio_name || 'studio').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const v = version ? `-v${version}` : '';
  return `${name}-handoff${v}.docx`;
}
