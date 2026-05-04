-- Phase 8 PAIR-03: RLS unit tests for public.pending_pairings.
-- Tests T5-T6 as specified in 08-02-PLAN.md <behavior>.
-- Convention: BEGIN; ... ROLLBACK; -- no committed state escapes.
-- pending_pairings has RLS ENABLED with NO policies = full deny for all client roles.
-- [Cited: 08-02-PLAN.md, CLAUDE.md RLS CI gate, existing test_cross_user_blocked.sql harness]

begin;

-- ── Setup ────────────────────────────────────────────────────────────────────
-- Insert test rows as service-role (simulates /api/pair-init writing).
set local role service_role;

insert into auth.users (id, instance_id, email, aud, role, raw_user_meta_data, created_at, updated_at)
values
  ('c3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'pp_user@devices.test', 'authenticated', 'authenticated', '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.pending_pairings (code, pubkey, gpu, engine_version, expires_at)
values
  ('ABCD-1234', '\xfacade01'::bytea, 'RX 6600 (Vulkan)', '0.2.0', now() + interval '10 minutes'),
  ('EXP1-EXP1', '\xfacade02'::bytea, 'RX 6600 (Vulkan)', '0.2.0', now() - interval '1 minute');

-- ── Test 5a: anon role cannot SELECT pending_pairings ────────────────────────
set local role anon;

do $$
declare cnt int;
begin
  begin
    select count(*) into cnt from public.pending_pairings;
    -- With deny-all RLS, anon gets 0 rows (not an error; RLS silently filters).
    if cnt <> 0 then
      raise exception 'PAIR-03 T5a violated: anon role sees % pending_pairings rows, expected 0', cnt;
    end if;
  exception
    when insufficient_privilege then
      -- Also acceptable: policy-less RLS may raise this on some Postgres versions.
      null;
  end;
end $$;

-- ── Test 5b: authenticated role (random user) cannot SELECT pending_pairings ─
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"c3000000-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.pending_pairings;
  if cnt <> 0 then
    raise exception 'PAIR-03 T5b violated: authenticated role sees % pending_pairings rows, expected 0 (deny-all RLS)', cnt;
  end if;
end $$;

-- ── Test 5c: authenticated role cannot INSERT into pending_pairings ───────────
do $$
declare rows_affected int;
begin
  begin
    insert into public.pending_pairings (code, pubkey, gpu, engine_version)
    values ('HACK-0001', '\xdeadbeef'::bytea, 'evil-gpu', '9.9.9');
    get diagnostics rows_affected = row_count;
    if rows_affected > 0 then
      raise exception 'PAIR-03 T5c violated: authenticated role inserted % rows into pending_pairings (deny-all expected)', rows_affected;
    end if;
  exception
    when insufficient_privilege then
      -- Expected: RLS denied the INSERT.
      null;
  end;
end $$;

-- ── Test 6: Expired rows are deleted by running the pg_cron body directly ────
-- Simulates the cron job's DELETE statement body running against expired rows.
-- 'EXP1-EXP1' has expires_at = now() - 1 minute, 'ABCD-1234' is still live.
set local role service_role;

do $$
declare rows_deleted int;
declare live_count   int;
begin
  -- Execute the same statement the cron job runs.
  delete from public.pending_pairings where expires_at < now();
  get diagnostics rows_deleted = row_count;

  -- Exactly the one expired row should have been deleted.
  if rows_deleted <> 1 then
    raise exception 'PAIR-03 T6 violated: cron body deleted % rows, expected 1 (only the expired row)', rows_deleted;
  end if;

  -- The live row ('ABCD-1234') must still be present.
  select count(*) into live_count from public.pending_pairings where code = 'ABCD-1234';
  if live_count <> 1 then
    raise exception 'PAIR-03 T6 violated: live pending_pairing was incorrectly deleted (expected 1 row remaining)';
  end if;
end $$;

-- ── Teardown ─────────────────────────────────────────────────────────────────
rollback;
