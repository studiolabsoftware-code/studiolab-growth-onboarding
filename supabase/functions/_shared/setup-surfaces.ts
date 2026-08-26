// Which Setup Checklist tiles a studio sees, and when.
//
// Extracted from get-studio-account/index.ts so it can be tested. An entrypoint
// cannot be imported under `deno test` without a Deno runtime and live env vars,
// so logic embedded in one is effectively untestable, and this logic decides
// whether a paying studio is shown a required step at all.
//
// TWO GROUPS. The access pack is every plan: the Google and social accounts we
// need delegated so we can do the work. The messaging pack is plan-gated (Scale
// unlocks SMS, Dominate AI adds WhatsApp) and, since 2026-08-26, STAGED.
//
// WHY STAGED (Gary's call). SMS registration is the most demanding thing we ask
// a studio for: two policy URLs, a plain-English description of how families
// consented, sample messages, and in the US a carrier filing on top. Presenting
// that on the day they paid, as one tile of eight, is how a checklist stops
// being finishable.
//
// His words were "until the account is live". That trigger could not be taken
// literally: account.html hides the entire checklist at `status = 'active'` and
// the activation banner tells the studio the portal is no longer needed, so
// gating on activation would have made these tiles unreachable rather than
// merely later. He chose the access pack as the trigger instead. It is entirely
// in the studio's own hands, needs no admin action, and leaves the go-live
// handover exactly as it is.

export const ACCESS_SURFACES = ['gbp', 'ga4', 'gsc', 'gtm', 'google_ads', 'meta', 'tiktok'] as const;

/** Messaging tiles this plan includes. Empty for Launch. */
export function messagingSurfacesFor(plan: string | null | undefined): string[] {
  const p = String(plan ?? '').trim().toLowerCase();
  if (p === 'ai') return ['sms_a2p', 'whatsapp'];
  if (p === 'scale') return ['sms_a2p'];
  return [];
}

export interface SurfaceVisibility {
  /** The surfaces to seed, fetch and render, in display order. */
  surfaces: string[];
  /** Messaging tiles exist for this plan but have not unlocked yet. */
  messagingPending: boolean;
}

/**
 * @param plan       the submission's plan
 * @param statusOf   current status for a surface; 'pending' (or absent) means
 *                   the studio has not opened that tile yet
 */
export function visibleSurfaces(
  plan: string | null | undefined,
  statusOf: (surface: string) => string | null | undefined,
): SurfaceVisibility {
  const messaging = messagingSurfacesFor(plan);
  const dealtWith = (surface: string) => {
    const s = String(statusOf(surface) ?? 'pending').trim();
    // Anything that is not 'pending' is the studio having dealt with the tile:
    // submitted, "I don't have this yet", we are actioning it, or done.
    // Requiring 'complete' would hold their next step behind OUR queue rather
    // than their own work, which is not what the staging is for.
    return Boolean(s) && s !== 'pending';
  };

  const accessPackDone = ACCESS_SURFACES.every(dealtWith);
  // Never take a tile away from somebody already working on it. A studio who
  // submitted SMS details before this staging existed keeps the tile, and so
  // does one whose admin has already started on it.
  const messagingStarted = messaging.some(dealtWith);
  const showMessaging = accessPackDone || messagingStarted;

  return {
    surfaces: [...ACCESS_SURFACES, ...(showMessaging ? messaging : [])],
    messagingPending: messaging.length > 0 && !showMessaging,
  };
}
