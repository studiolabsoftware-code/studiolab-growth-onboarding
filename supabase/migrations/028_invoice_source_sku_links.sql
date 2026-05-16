-- =============================================================================
-- Phase 6.3b item 3: invoice → catalog-SKU link for template materialisation
-- =============================================================================
-- When an admin builds an invoice using the catalog picker, we record which
-- SKUs the line items came from so the post-payment hook can materialise the
-- SKU's deliverable_template (added in migration 027) onto the spawned
-- project. This is purely additive metadata; nothing else reads it.
--
-- Shape per element: { kind: 'upgrade'|'general', id: <uuid of the SKU row> }
-- Validation lives in create-custom-invoice (write-side) and post-payment.ts
-- (read-side is defensive — unknown ids are skipped, never thrown).
-- =============================================================================

alter table public.invoices
  add column if not exists source_sku_links jsonb not null default '[]'::jsonb;

comment on column public.invoices.source_sku_links is
  'jsonb array of { kind: ''upgrade''|''general'', id: uuid } pointing at the '
  'catalog SKU rows (upgrade_products / general_products) whose '
  'deliverable_template should be materialised onto the spawned project when '
  'this invoice is paid. Empty array means no SKU was picked (free-text '
  'invoice) — spawning still happens, just with no auto-deliverables.';
