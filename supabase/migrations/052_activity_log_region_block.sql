-- =============================================================================
-- Allow activity_log.action = 'checkout_region_repriced'
-- =============================================================================
-- There are two commercial lines: Australia, and everyone else. When a studio's
-- own contact details show they are not Australian but they reached the /au/
-- form directly, create-checkout-session prices them on the everyone-else line
-- rather than stopping them. That correction is logged so it is visible rather
-- than a silent change of currency.
--
-- activity_log.action carries a CHECK constraint listing every permitted value.
-- Without this migration the insert fails, and because it is deliberately
-- wrapped in try/catch so a logging fault can never stop a checkout, it would
-- fail SILENTLY. That is the same shape as the placeholder-Vault fault found the
-- same day, so it is worth being explicit about.
--
-- The constraint is rebuilt from its own live definition rather than retyped:
-- transcribing 61 existing values by hand risks dropping one, which would start
-- rejecting a valid action somewhere else in the system.
-- =============================================================================

do $$
declare
  v_def text;
  v_new text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.activity_log'::regclass
    and conname  = 'activity_log_action_check';

  if v_def is null then
    raise exception 'activity_log_action_check not found; refusing to guess its shape.';
  end if;

  if position('checkout_region_repriced' in v_def) > 0 then
    raise notice 'checkout_region_repriced already permitted, nothing to do';
    return;
  end if;

  -- Anchored to the end of the definition: ... 'last_value'::text])))
  v_new := regexp_replace(
    v_def,
    '\]\)\)\)$',
    ', ''checkout_region_repriced''::text])))'
  );

  if v_new = v_def then
    raise exception 'Could not extend activity_log_action_check; unexpected shape: %', v_def;
  end if;

  execute 'alter table public.activity_log drop constraint activity_log_action_check';
  execute 'alter table public.activity_log add constraint activity_log_action_check ' || v_new;
  raise notice 'activity_log_action_check extended';
end$$;

-- Verify:
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conrelid='public.activity_log'::regclass and conname='activity_log_action_check';
