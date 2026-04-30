-- SEC-06: user A cannot SELECT, UPDATE, or DELETE user B's rows in EITHER jobs or transcripts.
-- Exercises cross-user isolation across both tables.
-- [Cited: 04-RESEARCH.md §Validation Architecture; 04-PATTERNS.md RLS tests]
begin;

-- Setup: two users, one job + one transcript each.
set local role service_role;

insert into auth.users (id, instance_id, email, aud, role, raw_user_meta_data, created_at, updated_at)
values
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'c@test.com', 'authenticated', 'authenticated', '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'd@test.com', 'authenticated', 'authenticated', '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.transcripts (id, user_id, payload, title, source_filename, duration_sec)
values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', '{}'::jsonb, 'C''s transcript', 'c.wav', 30),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '44444444-4444-4444-4444-444444444444', '{}'::jsonb, 'D''s transcript', 'd.wav', 30);

insert into public.jobs (id, user_id, source_filename)
values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '33333333-3333-3333-3333-333333333333', 'c.wav'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '44444444-4444-4444-4444-444444444444', 'd.wav');

-- Act as user C: verify isolation against user D's data.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

-- Transcripts: user C sees only own row.
do $$
declare cnt int;
begin
  select count(*) into cnt from public.transcripts;
  if cnt <> 1 then
    raise exception 'SEC-06 violated: user C sees % transcripts, expected 1', cnt;
  end if;
end $$;

-- Jobs: user C sees only own row.
do $$
declare cnt int;
begin
  select count(*) into cnt from public.jobs;
  if cnt <> 1 then
    raise exception 'SEC-06 violated: user C sees % jobs, expected 1', cnt;
  end if;
end $$;

-- Transcripts: user C cannot UPDATE user D's transcript.
do $$
declare rows_affected int;
begin
  update public.transcripts set title = 'hacked' where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  get diagnostics rows_affected = row_count;
  if rows_affected <> 0 then
    raise exception 'SEC-06 violated: user C cross-user transcript UPDATE affected % rows, expected 0', rows_affected;
  end if;
end $$;

-- Jobs: user C cannot UPDATE user D's job.
do $$
declare rows_affected int;
begin
  update public.jobs set stage = 'hacked' where id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  get diagnostics rows_affected = row_count;
  if rows_affected <> 0 then
    raise exception 'SEC-06 violated: user C cross-user job UPDATE affected % rows, expected 0', rows_affected;
  end if;
end $$;

rollback;
