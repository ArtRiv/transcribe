-- SEC-06: signed-in users SELECT their own transcripts only.
-- [Cited: 04-RESEARCH.md §Validation Architecture; 04-PATTERNS.md RLS tests]
begin;

-- Setup: insert two test users + one transcript per user via service-role.
set local role service_role;

insert into auth.users (id, instance_id, email, aud, role, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'a@test.com', 'authenticated', 'authenticated', '{}'::jsonb, now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'b@test.com', 'authenticated', 'authenticated', '{}'::jsonb, now(), now())
on conflict (id) do nothing;

insert into public.transcripts (id, user_id, payload, title, source_filename, duration_sec)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '{}'::jsonb, 'A''s file', 'a.wav', 30),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', '{}'::jsonb, 'B''s file', 'b.wav', 30);

-- Act as user A.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.transcripts;
  if cnt <> 1 then
    raise exception 'SEC-06 violated: user A sees % transcripts, expected 1', cnt;
  end if;
end $$;

-- Act as user B.
set local "request.jwt.claims" to '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.transcripts;
  if cnt <> 1 then
    raise exception 'SEC-06 violated: user B sees % transcripts, expected 1', cnt;
  end if;
end $$;

rollback;
