-- =============================================================================
-- Allow activity_log.action = 'checkout_blocked_region_mismatch'
-- =============================================================================
-- create-checkout-session now blocks a studio whose own contact details
-- contradict the region its form hard-set (a +64 phone or a non-Australian
-- postcode on the /au/ flow, or the reverse). That block is logged so a blocked
-- studio is visible to the team rather than a silently lost sale.
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

  if position('checkout_blocked_region_mismatch' in v_def) > 0 then
    raise notice 'checkout_blocked_region_mismatch already permitted, nothing to do';
    return;
  end if;

  -- Anchored to the end of the definition: ... 'last_value'::text])))
  v_new := regexp_replace(
    v_def,
    '\]\)\)\)$',
    ', ''checkout_blocked_region_mismatch''::text])))'
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
