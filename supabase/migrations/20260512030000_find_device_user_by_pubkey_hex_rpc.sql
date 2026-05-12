-- Phase 8 UAT-A fix: bypass Postgrest's bytea filter quirks.
--
-- supabase-js .eq("pubkey", "\\x<hex>") generates a URL that Postgrest
-- silently fails to match against the BYTEA column, even though a direct
-- curl with the same `?pubkey=eq.%5Cx<hex>` does match. Rather than
-- continue debugging the encoder, use a SQL function that takes hex and
-- does decode() server-side. Single source of truth, no filter ambiguity.
--
-- SECURITY DEFINER + service_role-only EXECUTE: this is called from
-- /api/signal-token which already runs under the service role.

create or replace function public.find_device_user_by_pubkey_hex(_pubkey_hex text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select user_id
  from public.devices
  where pubkey = decode(_pubkey_hex, 'hex')
  limit 1;
$$;

revoke all on function public.find_device_user_by_pubkey_hex(text) from public, anon, authenticated;
grant execute on function public.find_device_user_by_pubkey_hex(text) to service_role;

comment on function public.find_device_user_by_pubkey_hex(text) is
  'Phase 8 D-19 / UAT-A: hex pubkey -> devices.user_id. Bypasses Postgrest bytea filter encoding ambiguity. service_role only. Returns NULL when no row matches (signaling-token route maps to HTTP 404 device_not_found, which the engine treats as unpair signal — PAIR-06 / UAT-F).';
