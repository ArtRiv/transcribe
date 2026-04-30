-- CORE-08 / AUTH-09: schema-level NOT NULL on transcripts.user_id rejects NULL inserts.
-- The backend worker refuses to INSERT into transcripts when claims.is_anonymous=true;
-- this test verifies the schema-layer backstop (transcripts.user_id NOT NULL).
-- [Cited: 04-RESEARCH.md §Validation Architecture; 04-PATTERNS.md RLS tests]
begin;

set local role service_role;

do $$
begin
  begin
    insert into public.transcripts (id, user_id, payload, title, source_filename)
    values (gen_random_uuid(), null, '{}'::jsonb, 'should fail', 'fail.wav');
    raise exception 'CORE-08 violated: NULL user_id INSERT succeeded';
  exception when not_null_violation then
    -- Expected: schema enforces NOT NULL on transcripts.user_id.
    null;
  end;
end $$;

rollback;
