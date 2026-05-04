-- Phase 8 PAIR-03/05/06: RLS unit tests for public.devices.
-- Tests T1-T4 as specified in 08-02-PLAN.md <behavior>.
-- Convention: BEGIN; ... ROLLBACK; -- no committed state escapes.
-- [Cited: 08-02-PLAN.md, CLAUDE.md RLS CI gate, existing test_cross_user_blocked.sql harness]

begin;

-- ── Setup ────────────────────────────────────────────────────────────────────
set local role service_role;

insert into auth.users (id, instance_id, email, aud, role, raw_user_meta_data, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'dev_a@devices.test', 'authenticated', 'authenticated', '{}'::jsonb, now(), now()),
  ('b2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'dev_b@devices.test', 'authenticated', 'authenticated', '{}'::jsonb, now(), now())
on conflict (id) do nothing;

-- Insert user B's device row via service-role (simulates /api/pair-confirm).
insert into public.devices (user_id, pubkey, name, gpu)
values ('b2000000-0000-0000-0000-000000000002', '\xdeadbeef02'::bytea, 'gpu-host-b', 'RX 6600 (Vulkan)');

-- ── Test 1: User A cannot SELECT user B's devices row ────────────────────────
-- Acting as user A, expect 0 rows returned (cross-user isolation).
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.devices;
  if cnt <> 0 then
    raise exception 'PAIR-03 T1 violated: user A sees % devices rows, expected 0 (B row must be hidden)', cnt;
  end if;
end $$;

-- ── Test 2: User A cannot INSERT a row for user B ────────────────────────────
-- RLS denies client INSERT entirely (no insert policy exists for any client role).
do $$
declare rows_affected int;
begin
  begin
    insert into public.devices (user_id, pubkey, name, gpu)
    values ('b2000000-0000-0000-0000-000000000002', '\xdeadbeef03'::bytea, 'stolen', 'stolen-gpu');
    get diagnostics rows_affected = row_count;
    if rows_affected > 0 then
      raise exception 'PAIR-03 T2 violated: user A managed to INSERT a row for user B (% rows inserted)', rows_affected;
    end if;
  exception
    when insufficient_privilege then
      -- Expected: RLS denied the INSERT.
      null;
  end;
end $$;

-- ── Test 3: User A CAN DELETE their own row ───────────────────────────────────
-- First insert user A's device via service-role, then act as A and delete it.
set local role service_role;
insert into public.devices (user_id, pubkey, name, gpu)
values ('a1000000-0000-0000-0000-000000000001', '\xdeadbeef01'::bytea, 'gpu-host-a', 'RX 6600 (Vulkan)');

set local role authenticated;
set local "request.jwt.claims" to '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
declare rows_affected int;
begin
  delete from public.devices where user_id = 'a1000000-0000-0000-0000-000000000001';
  get diagnostics rows_affected = row_count;
  if rows_affected <> 1 then
    raise exception 'PAIR-05 T3 violated: user A DELETE of own row affected % rows, expected 1', rows_affected;
  end if;
end $$;

-- ── Test 4: Second INSERT for same user_id fails on PK violation (single-device-per-user) ──
-- user B already has a row. A service-role attempt to insert a second row for B must fail.
set local role service_role;

do $$
begin
  begin
    insert into public.devices (user_id, pubkey, name, gpu)
    values ('b2000000-0000-0000-0000-000000000002', '\xdeadbeef04'::bytea, 'duplicate', 'any-gpu');
    raise exception 'PAIR-05 T4 violated: second INSERT for same user_id succeeded (PK violation expected)';
  exception
    when unique_violation then
      -- Expected: PK on user_id rejects duplicate.
      null;
  end;
end $$;

-- ── Teardown ─────────────────────────────────────────────────────────────────
rollback;
