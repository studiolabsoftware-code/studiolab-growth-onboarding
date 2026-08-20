-- The AI knowledge base is no longer ours (2026-08-20).
--
-- StudioLAB Growth builds and populates it itself, from the studio's own data,
-- and it holds its own rules about what it will and will not say (including
-- never confirming pricing to a family). Facts and rules both. We do not
-- capture it, store it, or hand it over.
--
-- The columns stay rather than being dropped: dropping is irreversible, they
-- hold no data (no studio ever completed a knowledge base and no scrape ever
-- ran), and any historical row should keep round-tripping. Nothing writes them
-- any more: save-kb, scrape-and-extract, add-website-and-scrape and
-- copy-kb-for-ghl are deleted, and they are out of save-draft's and
-- apply-change-request's allow-lists.
--
-- These comments exist so the schema itself says so, rather than leaving a
-- future reader to infer from a column list that this is still a live surface.

do $$
declare c text;
begin
  foreach c in array array[
    'kb_profile','kb_classes','kb_pricing','kb_price_quoting','kb_policies',
    'kb_events','kb_faqs','kb_restricted','kb_tone','kb_greeting',
    'kb_assistant_persona_type','kb_assistant_persona_name','kb_completed_at',
    'kb_abandonment_nudged_at','kb_scrape_status','kb_scrape_started_at',
    'kb_scrape_completed_at','kb_scrape_pages_count','kb_scrape_sources',
    'kb_scrape_error','voice_hours','voice_escalate'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'submissions' and column_name = c
    ) then
      execute format(
        'comment on column public.submissions.%I is %L',
        c,
        'RETIRED 2026-08-20. StudioLAB Growth owns the AI knowledge base and populates it itself. Nothing writes this column; kept only so historical rows round-trip.'
      );
    end if;
  end loop;
end $$;
