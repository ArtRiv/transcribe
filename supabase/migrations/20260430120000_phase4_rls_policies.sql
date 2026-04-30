-- Phase 4: RLS policies on public.jobs and public.transcripts.
-- Adds owner-only SELECT/INSERT/UPDATE/DELETE policies (SEC-06).
-- Anon scoping (SEC-07) is achieved via the anonymous-sign-in pattern:
-- every visitor (anon or signed-in) has a non-null auth.uid(), and
-- jobs.user_id stores it. The legacy header-based anon-token scoping
-- pattern (CONTEXT.md D-30) is SUPERSEDED by 04-RESEARCH.md §Pattern 6.
--
-- Phase 1 already enabled RLS on both tables (deny-all default). This
-- migration ONLY adds policies — it does NOT toggle RLS state.
--
-- [Cited:
--   04-RESEARCH.md §Pattern 6 (lines 521-565)
--   04-RESEARCH.md §Pitfall 1 (Realtime ignores header claims — JWT only)
--   04-CONTEXT.md D-30 (now superseded — anon-sign-in is the canonical path)
--   CLAUDE.md "RLS-on in same migration" invariant (Phase 1 satisfied; we add policies)
-- ]

-- ── transcripts: owner-only on all four ops (SEC-06) ───────────────────
create policy transcripts_select_own on public.transcripts
  for select
  using (auth.uid() = user_id);

create policy transcripts_insert_own on public.transcripts
  for insert
  with check (auth.uid() = user_id);

create policy transcripts_update_own on public.transcripts
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy transcripts_delete_own on public.transcripts
  for delete
  using (auth.uid() = user_id);

-- Note on AUTH-09 / CORE-08:
--   Anonymous-sign-in JWTs have aud='authenticated' and a non-null sub,
--   so auth.uid() = user_id IS technically satisfiable for them.
--   BUT the application layer (backend worker progress.py) refuses to
--   INSERT a row whose owner is_anonymous=true. Belt + suspenders:
--   transcripts.user_id is NOT NULL at the schema level (Phase 1).
--
--   Defense-in-depth Phase 5 follow-up: add a policy
--     CHECK ((auth.jwt() ->> 'is_anonymous')::boolean IS DISTINCT FROM true)
--   on transcripts INSERT. Out of scope for Phase 4 (CONTEXT.md D-08
--   covers the in-app gate; the anon path never tries the INSERT).

-- ── jobs: owner-only on all four ops (SEC-06 + SEC-07 via anon-sign-in) ─
-- auth.uid() IS NOT NULL guards the rare case of a no-JWT direct Postgres
-- request — every legitimate path carries a JWT with non-null sub.
create policy jobs_select_own on public.jobs
  for select
  using (auth.uid() is not null and auth.uid() = user_id);

create policy jobs_insert_own on public.jobs
  for insert
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy jobs_update_own on public.jobs
  for update
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy jobs_delete_own on public.jobs
  for delete
  using (auth.uid() is not null and auth.uid() = user_id);

-- In practice, INSERT/UPDATE on jobs come from the FastAPI service-role,
-- which bypasses RLS. These policies are defense-in-depth for any future
-- client-side mutation path (and they're load-bearing for SELECT, which
-- is the Realtime subscription path).

-- ── anon_token vestigial (D-30 superseded) ──────────────────────────────
comment on column public.jobs.anon_token is
  'Vestigial under anonymous-sign-in pattern (Phase 4); kept for migration easy-undo. Not referenced by any RLS policy.';
