-- Phase 8: ephemeral 10-min-TTL handshake state between /api/pair-init and /api/pair-confirm.
-- RLS enabled with NO policies = full deny for anon/authenticated; service-role only path.

create table public.pending_pairings (
  code            text primary key,
  pubkey          bytea not null,
  gpu             text not null,                     -- B-02 D-13: engine-reported GPU label, e.g. "RX 6600 (Vulkan)"
  engine_version  text not null,                     -- B-02 D-13: engine semver string, e.g. "0.2.0"
  expires_at      timestamptz not null default (now() + interval '10 minutes'),
  created_at      timestamptz not null default now()
);

-- Index expires_at for the pg_cron cleanup query and ad-hoc reaping
create index pending_pairings_expires_at_idx on public.pending_pairings (expires_at);

alter table public.pending_pairings enable row level security;

-- Deny-all: no policies = no client access.
-- /api/pair-init writes via service-role; /api/pair-confirm reads-then-deletes via service-role.

comment on table public.pending_pairings is
  'Phase 8 D-02 D-03 D-13. (code, pubkey, gpu, engine_version) handshake row, 10-min TTL via pg_cron schedule (file 20260504120200). Service-role-only access. gpu + engine_version flow from engine -> /api/pair-init -> /pair card render (B-02).';
