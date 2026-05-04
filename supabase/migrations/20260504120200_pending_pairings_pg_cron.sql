-- Phase 8 pending_pairings TTL cleanup (RESEARCH §Open Question #6 resolution: pg_cron, not Vercel cron).
-- Runs every 5 minutes; deletes any row whose expires_at is in the past.
-- Idempotent: cron.schedule('job_name', ...) replaces an existing job with the same name on re-apply.

create extension if not exists pg_cron;

select cron.schedule(
  'pending_pairings_ttl_reaper',
  '*/5 * * * *',
  $$delete from public.pending_pairings where expires_at < now()$$
);

comment on extension pg_cron is
  'Phase 8 PAIR-03 TTL cleanup. Runs every 5 minutes per pg_cron docs.';
