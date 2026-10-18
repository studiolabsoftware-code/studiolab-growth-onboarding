# StudioLAB Growth — Onboarding: Claude operating context

This project covers StudioLAB Growth's onboarding flows — the journey from a studio signing up to becoming an active platform user. StudioLAB Growth is the marketing add-on; the underlying white-label platform is never named directly in customer-facing material or internal project outputs — always say "StudioLAB Growth."

Hub: `StudioLAB-Shared/projects/growth-onboarding/PROJECT.md` (where we work, handover branch).
Full operating context (technical lead, knowledge bases and reading order, Growth conventions, API
reference, the gate's history, why the site is `site/` only): `docs/claude-context.md`.
Codex reads `AGENTS.md` (pricing knowledge base, naming and output rules).

## Green gate

```bash
deno check supabase/functions/<function>/index.ts
deno test --allow-read supabase/functions/_shared/
node scripts/check-inline-js.mjs
```

**Type-check the function you touched, and expect to fix what you find.** **Put testable logic in
`supabase/functions/_shared/`, not in an `index.ts`.**

## THE SITE IS site/ AND ONLY site/

`app.studiolabgrowth.com` is published from **`site/`** by `.github/workflows/pages.yml`. Nothing
else in this repo reaches the public.

- A file is public **only** by being in `site/`. Put nothing there that is not a web asset.
- **Never repoint `path:` in the workflow at the repo root.** That single line is the boundary.
- **Do not switch the Pages source back to a branch** in repo settings. Build type must stay
  "GitHub Actions". A branch-root source republishes everything.
- **Never write a studio's name, payment amount, invoice number or record id into a tracked
  file.** Look identifiers up in the live database.
- If you move a folder, re-check every gitignore rule that names it.

**`site/js/form.js` ships via GitHub Pages on any push to `main`.** A change that spans it and the
Edge Functions must deploy the functions FIRST and push afterwards. Bump the `?v=` cache-buster
whenever `form.js` changes (files listed in `docs/claude-context.md`).
