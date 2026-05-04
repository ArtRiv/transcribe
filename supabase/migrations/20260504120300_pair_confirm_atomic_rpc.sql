-- Phase 8 D-04 atomic re-pair RPC. SECURITY DEFINER so the route's anon/authenticated
-- client can invoke it; the function body runs with the function-owner's privileges
-- (which has full table access) but is parameterized + scoped to the caller's user_id
-- via the explicit _user argument (route layer enforces _user = auth.uid() before calling).
--
-- Atomicity invariant: the DELETE of any prior devices row, the INSERT of the new
-- devices row, and the DELETE of the consumed pending_pairings row MUST all happen
-- inside a single Postgres transaction. PL/pgSQL functions run in the caller's
-- transaction by default -- no partial-write failure mode is acceptable per D-04.

create or replace function public.pair_confirm_atomic(
  _code     text,
  _user     uuid,
  _replace  boolean default false
) returns table (
  success         boolean,
  conflict        boolean,
  existing_name   text,
  existing_gpu    text,
  existing_seen   timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  _pending  public.pending_pairings%rowtype;
  _existing public.devices%rowtype;
begin
  -- 1. Read pending row (must exist + not expired)
  select * into _pending
    from public.pending_pairings
    where code = _code and expires_at > now()
    for update;
  if not found then
    return query select false, false, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- 2. Detect existing device for this user
  select * into _existing
    from public.devices
    where user_id = _user
    for update;

  if found and not _replace then
    -- Conflict: caller must re-invoke with _replace=true after user confirms D-04 flow.
    return query select false, true, _existing.name, _existing.gpu, _existing.last_seen;
    return;
  end if;

  -- 3. Atomic replace (or first-time insert)
  if found then
    delete from public.devices where user_id = _user;
  end if;

  insert into public.devices (user_id, pubkey, name, gpu, last_seen, created_at)
  values (_user, _pending.pubkey, '', _pending.gpu, now(), now());

  -- 4. Consume pending row
  delete from public.pending_pairings where code = _code;

  return query select true, false, null::text, null::text, null::timestamptz;
end;
$$;

-- Grant invocation to authenticated role (service-role auto-bypasses).
grant execute on function public.pair_confirm_atomic(text, uuid, boolean) to authenticated;

comment on function public.pair_confirm_atomic(text, uuid, boolean) is
  'Phase 8 D-04 atomic re-pair (B-03). Returns (success, conflict, existing_*) so the route layer can drive UI state without a second round-trip. Caller MUST set _user = auth.uid() before invoking.';
