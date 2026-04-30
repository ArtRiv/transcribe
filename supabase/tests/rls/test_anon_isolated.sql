-- SEC-07: two distinct anonymous-sign-in users each see only their own jobs row.
-- Both JWTs have is_anonymous=true and different sub values — auth.uid() still
-- provides per-user isolation because anonymous-sign-in assigns a stable UUID per session.
-- [Cited: 04-RESEARCH.md §Pattern 6 (SEC-07 via anon-sign-in); 04-PATTERNS.md RLS tests]
begin;

-- Setup: two anonymous users (distinct sub values, both is_anonymous=true), one job each.
set local role service_role;

insert into auth.users (id, instance_id, aud, role, raw_user_meta_data, is_anonymous, created_at, updated_at)
values
  ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{"is_anonymous":true}'::jsonb, true, now(), now()),
  ('66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '{"is_anonymous":true}'::jsonb, true, now(), now())
on conflict (id) do nothing;

insert into public.jobs (id, user_id, source_filename)
values
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'anon1.wav'),
  ('88888888-8888-8888-8888-888888888888', '66666666-6666-6666-6666-666666666666', 'anon2.wav');

-- Act as anonymous user 1.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","is_anonymous":true}';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.jobs;
  if cnt <> 1 then
    raise exception 'SEC-07 violated: anon user 1 sees % jobs, expected 1', cnt;
  end if;
end $$;

-- Act as anonymous user 2.
set local "request.jwt.claims" to '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated","is_anonymous":true}';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.jobs;
  if cnt <> 1 then
    raise exception 'SEC-07 violated: anon user 2 sees % jobs, expected 1', cnt;
  end if;
end $$;

rollback;
