-- Phase 1 SEC-01: RLS is enabled in the SAME migration as table creation.
-- Splitting CREATE TABLE and ENABLE RLS across files is the bug pattern that
-- produced the Lovable incident (170+ apps leaked via the public anon key).
-- See .planning/phases/01-foundation/01-RESEARCH.md "Pattern 2".

create extension if not exists "pgcrypto";

create table public.jobs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id) on delete cascade,  -- nullable for anon
  anon_token          text,                                               -- random per-job for anon RLS (Phase 4)
  storage_key         text,                                               -- nullable in v1 (TUS direct to FastAPI)
  source_filename     text not null,
  options             jsonb not null default '{}'::jsonb,
  status              text not null default 'queued'
                       check (status in ('queued','running','succeeded','failed','cancelled')),
  progress            smallint not null default 0
                       check (progress between 0 and 100),
  stage               text,
  error               text,
  transcript_payload  jsonb,                                              -- anon: held here; signed-in: also written to transcripts
  transcript_id       uuid,                                               -- FK added in transcripts migration (file 0002)
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz
);

create index jobs_status_created_idx on public.jobs (status, created_at);
create index jobs_user_idx on public.jobs (user_id) where user_id is not null;

-- SEC-01: enable RLS on the very same migration as CREATE TABLE.
alter table public.jobs enable row level security;

-- Default deny-all: no SELECT/INSERT/UPDATE/DELETE policies for clients.
-- The FastAPI service-role key bypasses RLS for backend writes.
-- Phase 4 will ADD targeted SELECT policies for signed-in users (auth.uid() = user_id)
-- and for anon users via X-Anon-Token header (request.headers ->> 'x-anon-token').
-- For Phase 1, "deny everything" is the correct posture.

comment on table public.jobs is
  'Phase 1: RLS enabled, no policies = full deny. Phase 4 adds owner + anon-token policies.';
