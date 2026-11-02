// One Setup Checklist tile: what a studio may save for it. Moved out of studio-save-setup-task so the
// dashboard's path applies the same rules, and staff see the same rows and the same inbox lines.
import { smsFieldKeys } from './sms-registration.ts';

export type SurfaceKey =
  | 'gbp' | 'ga4' | 'gsc' | 'gtm' | 'google_ads' | 'meta' | 'tiktok'
  | 'sms_a2p' | 'whatsapp';
export const VALID_SURFACES = new Set<string>([
  'gbp', 'ga4', 'gsc', 'gtm', 'google_ads', 'meta', 'tiktok',
  'sms_a2p', 'whatsapp',
]);

// Per-surface allowed keys in the `data` jsonb. Any other key in the
// incoming payload is silently dropped to keep the column tidy.
const SURFACE_FIELDS: Record<SurfaceKey, string[]> = {
  gbp:        ['maps_url', 'place_id', 'verification_status', 'notes'],
  ga4:        ['measurement_id', 'property_id', 'account_name', 'notes'],
  gsc:        ['property_url', 'property_type', 'notes'],
  gtm:        ['container_id', 'account_id', 'site_platform', 'notes'],
  google_ads: ['customer_id', 'account_currency', 'account_timezone', 'notes'],
  meta:       ['business_manager_id', 'page_url', 'page_id', 'instagram_username',
               'instagram_is_professional', 'instagram_linked_to_page',
               'ad_account_id', 'pixel_id', 'notes'],
  tiktok:     ['business_center_id', 'ad_account_id', 'handle',
               'handle_is_business', 'notes'],
  // Taken from the tile's own definition rather than restated here. Which of
  // these a studio is SHOWN depends on their country (the US Campaign Registry
  // fields are asked for nowhere else), but what we ALLOW is the union: a
  // studio whose country resolves differently between two visits must not have
  // work they already submitted rejected at the door.
  sms_a2p:    smsFieldKeys(),
  whatsapp:   ['enabled', 'display_name', 'business_category',
               'verification_doc_url', 'notes'],
};

export const SURFACE_LABEL: Record<SurfaceKey, string> = {
  gbp:        'Google Business Profile',
  ga4:        'Google Analytics 4',
  gsc:        'Google Search Console',
  gtm:        'Google Tag Manager',
  google_ads: 'Google Ads',
  meta:       'Meta Business Manager',
  tiktok:     'TikTok Business Center',
  sms_a2p:    'SMS compliance & A2P registration',
  whatsapp:   'WhatsApp Business',
};

export type StatusKey = 'pending' | 'submitted' | 'no_account';
export const VALID_STATUSES = new Set<string>(['pending', 'submitted', 'no_account']);

export function cleanTaskData(surface: SurfaceKey, data: Record<string, unknown>): Record<string, unknown> {
  const allowedKeys = new Set(SURFACE_FIELDS[surface]);
  const cleanData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!allowedKeys.has(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      const trimmed = v.trim();
      if (trimmed) cleanData[k] = trimmed.slice(0, 2000);
    } else if (typeof v === 'boolean' || typeof v === 'number') {
      cleanData[k] = v;
    }
  }
  return cleanData;
}

export function taskMessage(surface: SurfaceKey, status: string): string {
  const label = SURFACE_LABEL[surface];
  return status === 'submitted'
    ? `Studio submitted ${label} access details. Setup Checklist tile is ready for us to action.`
    : `Studio flagged "I don't have ${label} yet" — they need us to set it up on their behalf.`;
}

// Whose move it is, as the studio sees it. Mirrors the status staff set in the Setup Queue, read fresh.
export function taskOwner(status: string | null | undefined): 'you' | 'us' | 'done' {
  const s = String(status ?? 'pending');
  if (s === 'complete') return 'done';
  return s === 'pending' ? 'you' : 'us';
}

// Third-party waits the studio can mark, with the longest stated wait (plan section 3). Days are calendar
// days. Past the maximum the sweep raises `third_party_overrun`. One place, so thresholds change in one file.
export const THIRD_PARTY_WAITS: Partial<Record<SurfaceKey, { who: string; maxDays: number }>> = {
  gbp: { who: 'Google', maxDays: 21 },
  meta: { who: 'Meta', maxDays: 20 },
  whatsapp: { who: 'Meta', maxDays: 20 },
  sms_a2p: { who: 'the phone carriers', maxDays: 21 },
};
