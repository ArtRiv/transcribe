-- Phase 1 PROG-03 prerequisite (Phase 3 wires the subscription in the browser):
-- add both tables to the supabase_realtime publication so Postgres Changes
-- broadcast to subscribed Realtime clients.

alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.transcripts;
