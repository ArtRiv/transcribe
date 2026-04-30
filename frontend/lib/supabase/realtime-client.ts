// Supabase Realtime postgres_changes subscription helper (PROG-03).
//
// The shape `supabase.channel(...).on('postgres_changes', ..., cb).subscribe()`
// is THE contract that the Phase 3 mock stub (lib/mock/realtime.ts, Plan 03-07)
// also implements. Phase 4 swaps the createSupabaseClient() implementation;
// every consumer (page.tsx, editor-client.tsx) keeps the same import.
//
// Stage labels MUST match backend/app/queue/worker.py lines 75-80:
//   extracting → transcribing → diarizing → merging → done; +cancelling on cancel.
//
// RLS / anon-token enforcement is Phase 4 work. Phase 3 mock mode bypasses
// Supabase entirely; Phase 3 real mode (NEXT_PUBLIC_USE_MOCKS=0) reads anon-key
// only — the service-role key NEVER appears here (CLAUDE.md perimeter).
//
// [Cited: RESEARCH §Pattern 4; PROJECT.md "Progress channel = Supabase Realtime"]
// [Phase 4: singleton moved to client.ts; this module imports via getSupabaseBrowserClient]

import { REALTIME_LISTEN_TYPES } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** The Postgres `jobs` row shape exposed to the UI.
 *  Matches Phase 1 supabase migration + worker.py stage emissions. */
export interface JobRow {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "cancelling";
  stage:
    | "extracting"
    | "transcribing"
    | "diarizing"
    | "merging"
    | "done"
    | "cancelling"
    | null;
  progress: number;       // 0-100
  error: string | null;
  transcript_payload: unknown | null;
  // Phase 4 will add updatedAt (server timestamptz) for D-30 restore comparison.
  updated_at?: string;
}

/** @deprecated Use getSupabaseBrowserClient() from @/lib/supabase/client instead.
 *  Kept for backward compatibility with Phase 3 consumers. */
export const createSupabaseClient = getSupabaseBrowserClient;

/** Subscribe to UPDATE events on the given jobs row.
 *  Returns an unsubscribe function. */
export function subscribeToJob(
  jobId: string,
  onUpdate: (row: JobRow) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  const channel = supabase
    .channel(`job-${jobId}`)
    // EXACT shape per RESEARCH §Pattern 4 — Phase 4 swap depends on this matching.
    .on(
      REALTIME_LISTEN_TYPES.POSTGRES_CHANGES,
      {
        event: "UPDATE",
        schema: "public",
        table: "jobs",
        filter: `id=eq.${jobId}`,
      },
      // Per Pattern 4 line 569: payload shape is { eventType: 'UPDATE', new: {...}, old: {...}, schema, table, errors }
      (payload: { new: JobRow }) => onUpdate(payload.new),
    )
    .subscribe((status) => {
      // Per Pitfall 2 line 1062: on SUBSCRIBED, issue a one-shot fetch to reconcile
      // any UPDATE events that fired during a disconnect. Phase 4 wires the fetch
      // to GET /jobs/{id}; Phase 3 mock holds the latest emitted row so this is a no-op
      // in mock mode. Real-mode reconcile is added in Plan 04-XX (Phase 4 integration).
      void status;  // referenced to silence lint; intentional no-op in Phase 3.
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
