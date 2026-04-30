-- Phase 4 D-05: 24-hour anon-job cleanup RPC.
-- SECURITY DEFINER so the service-role can call this function and let
-- it read auth.users (normally restricted).
-- [Cited: 04-RESEARCH.md §Pattern 8 + Assumption A4]
create or replace function public.cleanup_anon_jobs(ttl_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.jobs j
  where j.user_id is not null
    and j.created_at < now() - make_interval(hours => ttl_hours)
    and exists (
      select 1 from auth.users u
      where u.id = j.user_id
        and u.is_anonymous = true
    );
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;

-- Restrict execution to service-role only.
revoke all on function public.cleanup_anon_jobs(integer) from public, anon, authenticated;
grant execute on function public.cleanup_anon_jobs(integer) to service_role;

comment on function public.cleanup_anon_jobs(integer) is
  'Deletes anonymous jobs older than ttl_hours (default 24). '
  'Phase 4 D-05; called from FastAPI lifespan cleanup_anon_jobs_loop.';
