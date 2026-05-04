-- Phase 8 SEC-01 / CLAUDE.md: RLS is ENABLE'd in the SAME migration as CREATE TABLE.
-- D-19: column types + indexing. PAIR-05: single-device-per-user enforced via PK on user_id.

create extension if not exists "pgcrypto";

create table public.devices (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  pubkey      bytea not null,
  name        text not null default '',
  gpu         text not null default '',
  last_seen   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

-- pubkey lookup is the hot path for /api/signal-token (challenge-response verifies sig vs stored pubkey)
create unique index devices_pubkey_idx on public.devices (pubkey);

alter table public.devices enable row level security;

-- D-04 re-pair flow: client never directly INSERTs/UPDATEs; the /api/pair-confirm
-- service-role path performs the atomic delete-then-insert when replacing a paired engine.
create policy devices_select_own on public.devices
  for select using (auth.uid() is not null and auth.uid() = user_id);

create policy devices_delete_own on public.devices
  for delete using (auth.uid() is not null and auth.uid() = user_id);

-- NO insert/update policies for clients -- service-role on /api/pair-confirm only.

comment on table public.devices is
  'Phase 8 PAIR-03/05/06. Single device per user (PK on user_id). RLS owner-read/owner-delete; INSERT and UPDATE go through service-role on /api/pair-confirm.';
