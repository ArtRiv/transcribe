-- SEC-06: signed-in users can DELETE their own transcripts; cannot DELETE another user's.
-- [Cited: 04-RESEARCH.md §Validation Architecture; 04-PATTERNS.md RLS tests]
begin;

-- Setup: two users, one transcript each.
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

-- Act as user A: delete own row — expect 1 row affected.
set local role authenticated;
set local "request.jwt.claims" to '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare rows_affected int;
begin
  delete from public.transcripts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  get diagnostics rows_affected = row_count;
  if rows_affected <> 1 then
    raise exception 'SEC-06 violated: user A own-row DELETE affected % rows, expected 1', rows_affected;
  end if;
end $$;

-- User A tries to delete user B's row — expect 0 rows affected (RLS hides it).
do $$
declare rows_affected int;
begin
  delete from public.transcripts where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  get diagnostics rows_affected = row_count;
  if rows_affected <> 0 then
    raise exception 'SEC-06 violated: user A cross-user DELETE affected % rows, expected 0', rows_affected;
  end if;
end $$;

rollback;
