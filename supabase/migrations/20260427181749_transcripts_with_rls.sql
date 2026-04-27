-- Phase 1 SEC-01: RLS in the same file as CREATE TABLE.
-- This file also adds the FK from jobs.transcript_id (created in 0001) to transcripts.id —
-- it has to be here because the FK target didn't exist when 0001 ran.

create table public.transcripts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null,
  source_filename text not null,
  duration_sec    integer,
  language        text,
  model_used      text,
  diarized        boolean not null default false,
  payload         jsonb not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index transcripts_user_created_idx
  on public.transcripts (user_id, created_at desc);

alter table public.transcripts enable row level security;

-- Wire the FK from jobs.transcript_id (created without target in 0001) -> transcripts.id
alter table public.jobs
  add constraint jobs_transcript_fk
  foreign key (transcript_id) references public.transcripts(id) on delete set null;

comment on table public.transcripts is
  'Phase 1: RLS enabled, no policies = full deny. Phase 4 adds owner-only policies.';
