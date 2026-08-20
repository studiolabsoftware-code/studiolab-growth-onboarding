// One normaliser for discount codes, imported by BOTH sides.
//
// It lives here because reader and writer silently disagreeing is a real bug this codebase already
// had: manage-discount-codes collapsed internal whitespace to a hyphen when storing, _shared/pricing
// only trimmed and upper-cased when looking up, so a code created as "EARLY BIRD" was stored as
// "EARLY-BIRD" and could never be redeemed by typing it the way it was written down.
//
// That was survivable while the lookup used .ilike(), which at least matched case-insensitively.
// With the LIKE wildcard removed on 2026-08-21 the lookup is an exact match, so the two sides
// agreeing is now load-bearing rather than merely tidy. Making them import the same function is
// stronger than a test that compares the two source files for an identical string, because there is
// only one definition left to get wrong.
//
// Migration 049 pins the same invariant in the database: a stored code must be upper-case, carry no
// whitespace, and be non-empty - which is exactly the set of shapes this function can produce.

/**
 * Canonical form of a discount code: trimmed, upper-cased, with internal whitespace runs collapsed
 * to a single hyphen. Returns '' for anything blank, which every caller must treat as "no code"
 * rather than as a code to look up (an empty string is a value `.eq()` would happily match).
 */
export function normaliseDiscountCode(raw: unknown): string {
  // `|| ''` and NOT `?? ''`, which is what an earlier draft of this file used. The writer's original
  // inline version used `||`, so a payload of `code: 0` or `code: false` normalised to blank and was
  // rejected as "Code cannot be blank". `??` only catches null and undefined, so those would have
  // become the codes "0" and "FALSE" instead. Caught on review; a security fix is the wrong place to
  // quietly change what the write path accepts.
  return String(raw || '').trim().toUpperCase().replace(/\s+/g, '-');
}
