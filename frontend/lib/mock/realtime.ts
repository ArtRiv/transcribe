// Mock Realtime client (D-18). Surface mirrors @supabase/supabase-js
// channel().on('postgres_changes', ...).subscribe() so Phase 4's swap is
// one import line in lib/supabase/realtime-client.ts.
//
// Scripted timeline per UI-SPEC §14.4:
//   t=0       queued
//   t=250ms   running / extracting / progress=5
//   t=750ms   transcribing / progress=10
//   t=750-12000  ramp 10→80 (every 250ms)
//   t=12250   diarizing / progress=80
//   t=12250-17000  ramp 80→95
//   t=17250   merging / progress=95
//   t=17500   merging / progress=99
//   t=18000   succeeded / done / progress=100 / transcript_payload=SAMPLE_PAYLOAD
//
// Two env-var hooks for testing edge states:
//   NEXT_PUBLIC_MOCK_JOBS_AHEAD=N   → hold queued for 6s with `queued — N ahead of you`
//   NEXT_PUBLIC_MOCK_FAIL_AT_STAGE=<stage>  → emit failed at the named stage instead of succeeded

import { env } from "@/lib/env";
if (env.NEXT_PUBLIC_USE_MOCKS !== "1" && typeof window !== "undefined") {
  console.warn(
    "[mock/realtime] imported in non-mock environment — this should tree-shake out in prod.",
  );
}

import type { JobRow } from "@/lib/supabase/realtime-client";
import { SAMPLE_PAYLOAD } from "./data";

type UpdateCallback = (payload: {
  eventType: "UPDATE";
  new: JobRow;
  old: Partial<JobRow>;
  schema: string;
  table: string;
}) => void;

// Per-jobId state (the timeline emits scripted UPDATEs).
const subscribers = new Map<string, Set<UpdateCallback>>();
const lastRow = new Map<string, JobRow>();
const timers = new Map<string, ReturnType<typeof setTimeout>[]>();

function broadcast(jobId: string, partial: Partial<JobRow>): void {
  const prev = lastRow.get(jobId) ?? {
    id: jobId,
    status: "queued" as const,
    stage: null,
    progress: 0,
    error: null,
    transcript_payload: null,
  };
  const next: JobRow = { ...prev, ...partial };
  lastRow.set(jobId, next);
  const subs = subscribers.get(jobId);
  if (!subs) return;
  for (const cb of subs) {
    cb({
      eventType: "UPDATE",
      new: next,
      old: prev,
      schema: "public",
      table: "jobs",
    });
  }
}

/**
 * Public API for handlers.ts: kick off the scripted timeline for a freshly-submitted job.
 * Idempotent — calling twice for the same jobId resets the timeline.
 */
export function startMockJob(jobId: string): void {
  cancelTimers(jobId);

  // Static property access is required — Next.js only inlines NEXT_PUBLIC_*
  // into the browser bundle when accessed as a literal property. Dynamic
  // access (`process.env[name]`) compiles to `undefined` in the browser.
  const failAtStage = process.env.NEXT_PUBLIC_MOCK_FAIL_AT_STAGE || undefined;
  const jobsAhead =
    parseInt(process.env.NEXT_PUBLIC_MOCK_JOBS_AHEAD ?? "0", 10) || 0;
  const queueDelay = jobsAhead > 0 ? 6000 : 0;

  const ts: ReturnType<typeof setTimeout>[] = [];

  // t=0  queued
  ts.push(
    setTimeout(
      () => broadcast(jobId, { status: "queued", stage: null, progress: 0 }),
      0,
    ),
  );

  // After queue delay, kick off pipeline.
  const start = queueDelay + 250;
  ts.push(
    setTimeout(
      () =>
        broadcast(jobId, {
          status: "running",
          stage: "extracting",
          progress: 5,
        }),
      start,
    ),
  );
  ts.push(
    setTimeout(
      () =>
        broadcast(jobId, {
          status: "running",
          stage: "transcribing",
          progress: 10,
        }),
      start + 500,
    ),
  );

  // Ramp transcribing 10→80 over ~12s in 36 ticks (~250ms each).
  const transcribeStart = start + 500;
  const transcribeEnd = start + 12000;
  const transcribeTicks = Math.floor((transcribeEnd - transcribeStart) / 250);
  for (let i = 1; i <= transcribeTicks; i++) {
    const at = transcribeStart + i * 250;
    const pct = Math.min(80, 10 + (i / transcribeTicks) * 70);
    ts.push(
      setTimeout(() => {
        if (failAtStage === "transcribing" && pct >= 40) {
          broadcast(jobId, {
            status: "failed",
            stage: "transcribing",
            progress: 40,
            error: "Mock failure: VAD timeout",
          });
          cancelTimers(jobId);
          return;
        }
        broadcast(jobId, {
          status: "running",
          stage: "transcribing",
          progress: Math.round(pct),
        });
      }, at),
    );
  }

  // Diarizing 80→95 over ~5s.
  const diarizeStart = transcribeEnd + 250;
  const diarizeEnd = diarizeStart + 4750;
  ts.push(
    setTimeout(
      () =>
        broadcast(jobId, {
          status: "running",
          stage: "diarizing",
          progress: 80,
        }),
      diarizeStart,
    ),
  );
  const diarizeTicks = Math.floor((diarizeEnd - diarizeStart) / 250);
  for (let i = 1; i <= diarizeTicks; i++) {
    const at = diarizeStart + i * 250;
    const pct = Math.min(95, 80 + (i / diarizeTicks) * 15);
    ts.push(
      setTimeout(() => {
        if (failAtStage === "diarizing" && pct >= 90) {
          broadcast(jobId, {
            status: "failed",
            stage: "diarizing",
            progress: 90,
            error: "Mock failure: diarization timeout",
          });
          cancelTimers(jobId);
          return;
        }
        broadcast(jobId, {
          status: "running",
          stage: "diarizing",
          progress: Math.round(pct),
        });
      }, at),
    );
  }

  // Merging.
  ts.push(
    setTimeout(
      () =>
        broadcast(jobId, { status: "running", stage: "merging", progress: 95 }),
      diarizeEnd + 250,
    ),
  );
  ts.push(
    setTimeout(
      () =>
        broadcast(jobId, { status: "running", stage: "merging", progress: 99 }),
      diarizeEnd + 500,
    ),
  );

  // Done.
  ts.push(
    setTimeout(() => {
      if (failAtStage === "merging") {
        broadcast(jobId, {
          status: "failed",
          stage: "merging",
          progress: 99,
          error: "Mock failure: merge step",
        });
        return;
      }
      broadcast(jobId, {
        status: "succeeded",
        stage: "done",
        progress: 100,
        transcript_payload: SAMPLE_PAYLOAD,
      });
    }, diarizeEnd + 1000),
  );

  timers.set(jobId, ts);
}

/** Public API for the DELETE /jobs/{id} handler — emit cancelling → cancelled 800ms apart. */
export function cancelMockJob(jobId: string): void {
  cancelTimers(jobId);
  broadcast(jobId, { status: "cancelling", stage: "cancelling" });
  setTimeout(() => broadcast(jobId, { status: "cancelled" }), 800);
}

function cancelTimers(jobId: string): void {
  const ts = timers.get(jobId);
  if (ts) {
    for (const t of ts) clearTimeout(t);
    timers.delete(jobId);
  }
}

/**
 * Mirror of @supabase/supabase-js client surface.
 *
 * Phase 4 swap path: lib/supabase/realtime-client.ts's createSupabaseClient()
 * gets an env-gated branch — when NEXT_PUBLIC_USE_MOCKS=1, return this
 * mock client; otherwise return createBrowserClient(...).
 */
export function createMockSupabaseClient() {
  return {
    channel(name: string) {
      // Extract jobId from channel name "job-{jobId}" — must match
      // the channel name in lib/supabase/realtime-client.ts subscribeToJob.
      const jobId = name.startsWith("job-") ? name.slice(4) : name;

      return {
        on(_event: "postgres_changes", _filter: unknown, cb: UpdateCallback) {
          return {
            subscribe: (statusCb?: (status: string) => void) => {
              if (!subscribers.has(jobId)) subscribers.set(jobId, new Set());
              subscribers.get(jobId)!.add(cb);
              // Replay last known row so consumers reconnecting see current state.
              const last = lastRow.get(jobId);
              if (last) {
                cb({
                  eventType: "UPDATE",
                  new: last,
                  old: last,
                  schema: "public",
                  table: "jobs",
                });
              }
              statusCb?.("SUBSCRIBED");
              return {
                /** No-op for parity with Realtime channel.unsubscribe(). */
                unsubscribe() {
                  subscribers.get(jobId)?.delete(cb);
                },
              };
            },
          };
        },
      };
    },
    removeChannel(_channel: unknown) {
      // The mock holds Set<callback> per jobId; the real client returns Promise<"ok"|"error"|"timed out">.
      return Promise.resolve("ok" as const);
    },
  };
}
