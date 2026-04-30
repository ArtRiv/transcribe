"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type * as tus from "tus-js-client";
import {
  LandingHero,
  LandingFooter,
} from "@/components/transcribe/landing-hero";
import { UploadZone } from "@/components/transcribe/upload-zone";
import { OptionsPanel } from "@/components/transcribe/options-panel";
import { ProcessingCard } from "@/components/transcribe/processing-card";
import { Button } from "@/components/ui/button";
import { submitJob, type JobOptions } from "@/lib/job/submit";
import { subscribeToJob, type JobRow } from "@/lib/supabase/realtime-client";
import { useEditorStore } from "@/lib/editor/store";
import { env } from "@/lib/env";
import { ensureAnonymousSession } from "@/lib/auth/anonymous";

type Phase =
  | "idle"
  | "uploading"
  | "queued"
  | "transcribing"
  | "diarizing"
  | "merging"
  | "done"
  | "failed"
  | "cancelling";

interface PageState {
  phase: Phase;
  file: File | null;
  duration: number | null;
  options: JobOptions;
  jobId: string | null;
  uploadPct: number;
  progress: number;
  queueAhead: number;
  error: string | null;
  validationError: string | null;
}

type PageAction =
  | { type: "set_file"; file: File }
  | { type: "clear_file" }
  | { type: "set_duration"; duration: number }
  | { type: "set_options"; options: JobOptions }
  | { type: "set_validation_error"; error: string | null }
  | { type: "submit_start"; jobId: string }
  | { type: "set_upload_pct"; pct: number }
  | { type: "realtime_update"; row: JobRow; queueAhead: number }
  | { type: "submit_error"; error: string }
  | { type: "cancel_start" }
  | { type: "cancelled" }
  | { type: "reset" };

const initialState: PageState = {
  phase: "idle",
  file: null,
  duration: null,
  options: { preset: "average", diarize: true, num_speakers: 0 },
  jobId: null,
  uploadPct: 0,
  progress: 0,
  queueAhead: 0,
  error: null,
  validationError: null,
};

function reduce(s: PageState, a: PageAction): PageState {
  switch (a.type) {
    case "set_file":
      return { ...s, file: a.file, duration: null, validationError: null };
    case "clear_file":
      return { ...s, file: null, duration: null, validationError: null };
    case "set_duration":
      return { ...s, duration: a.duration };
    case "set_options":
      return { ...s, options: a.options };
    case "set_validation_error":
      return { ...s, validationError: a.error };
    case "submit_start":
      return {
        ...s,
        phase: "uploading",
        jobId: a.jobId,
        uploadPct: 0,
        progress: 0,
        error: null,
      };
    case "set_upload_pct":
      return { ...s, uploadPct: a.pct };
    case "realtime_update": {
      const row = a.row;
      const queueAhead = a.queueAhead;
      if (row.status === "queued") {
        return { ...s, phase: "queued", queueAhead };
      }
      if (row.status === "failed") {
        return {
          ...s,
          phase: "failed",
          error: row.error ?? "Unknown error",
          progress: row.progress,
        };
      }
      if (row.status === "cancelling") return { ...s, phase: "cancelling" };
      if (row.status === "cancelled")
        return {
          ...initialState,
          file: s.file,
          duration: s.duration,
          options: s.options,
        };
      if (row.status === "succeeded") {
        return { ...s, phase: "done", progress: 100 };
      }
      // running — driven by stage label
      const stage = row.stage;
      if (stage === "extracting" || stage === "transcribing")
        return { ...s, phase: "transcribing", progress: row.progress };
      if (stage === "diarizing")
        return { ...s, phase: "diarizing", progress: row.progress };
      if (stage === "merging")
        return { ...s, phase: "merging", progress: row.progress };
      return s;
    }
    case "submit_error":
      return { ...s, phase: "failed", error: a.error };
    case "cancel_start":
      return { ...s, phase: "cancelling" };
    case "cancelled":
      return {
        ...initialState,
        file: s.file,
        duration: s.duration,
        options: s.options,
      };
    case "reset":
      return { ...initialState, options: s.options };
  }
}

/** Validate file pre-submit (CORE-03). */
const ALLOWED_EXTS = new Set([
  "mp3",
  "m4a",
  "wav",
  "mp4",
  "mov",
  "webm",
  "ogg",
  "flac",
  "aac",
]);
const MAX_DURATION_SEC = 5 * 60 * 60; // 5 hours
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

function validate(file: File, duration: number | null): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTS.has(ext)) {
    return `${file.name} isn't a supported audio or video file. Try mp3, m4a, wav, mp4, mov, or webm.`;
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `Files over ${MAX_FILE_SIZE_BYTES / (1024 * 1024 * 1024)} GB or 5 hours can't process here. Trim it down or split it first.`;
  }
  if (duration != null && duration > MAX_DURATION_SEC) {
    return `Files over ${MAX_FILE_SIZE_BYTES / (1024 * 1024 * 1024)} GB or 5 hours can't process here. Trim it down or split it first.`;
  }
  return null;
}

/**
 * Resolve the Realtime client.
 * - Phase 3 + NEXT_PUBLIC_USE_MOCKS=1: createMockSupabaseClient() driven by
 *   the MSW handler (lib/mock/realtime.ts).
 * - Phase 4 / production: subscribeToJob from lib/supabase/realtime-client.ts.
 *
 * Uses process.env.NEXT_PUBLIC_USE_MOCKS directly (not via the env wrapper)
 * so Next.js inlines it at build time — the bundler can dead-code-eliminate
 * the false branch and tree-shake lib/mock/realtime out of the production
 * bundle (T-03-49 mitigation; acceptance criterion §13 verifies .next/server).
 */
async function subscribeJobScoped(
  jobId: string,
  onUpdate: (row: JobRow) => void,
): Promise<() => void> {
  if (process.env.NEXT_PUBLIC_USE_MOCKS === "1") {
    const mod = await import("@/lib/mock/realtime");
    const client = mod.createMockSupabaseClient();
    const handler = (payload: { new: JobRow }) => onUpdate(payload.new);
    const sub = client
      .channel(`job-${jobId}`)
      .on("postgres_changes", {}, handler)
      .subscribe();
    return () => sub.unsubscribe();
  }
  // Real path
  return Promise.resolve(subscribeToJob(jobId, onUpdate));
}

export default function HomePage() {
  const router = useRouter();
  const [state, dispatch] = React.useReducer(reduce, initialState);
  const setFileRef = useEditorStore((s) => s.setFile);
  const tusHandleRef = React.useRef<tus.Upload | null>(null);

  // Subscribe to Realtime once we have a jobId.
  React.useEffect(() => {
    if (!state.jobId) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      unsubscribe = await subscribeJobScoped(state.jobId!, (row) => {
        // queueAhead estimation: backend doesn't expose this directly in Phase 3;
        // mock can set NEXT_PUBLIC_MOCK_JOBS_AHEAD. Real Phase 4 will compute via
        // a separate GET /queue endpoint.
        const aheadRaw =
          process.env.NEXT_PUBLIC_USE_MOCKS === "1"
            ? parseInt(process.env.NEXT_PUBLIC_MOCK_JOBS_AHEAD ?? "0", 10) || 0
            : 0;
        dispatch({ type: "realtime_update", row, queueAhead: aheadRaw });
      });
      if (cancelled && unsubscribe) unsubscribe();
    })();
    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [state.jobId]);

  // Done → 1400ms beat → router.replace
  React.useEffect(() => {
    if (state.phase !== "done" || !state.jobId) return;
    const t = setTimeout(() => {
      if (state.jobId) router.replace(`/job/${state.jobId}`);
    }, 1400);
    return () => clearTimeout(t);
  }, [state.phase, state.jobId, router]);

  const onFile = React.useCallback((file: File) => {
    const err = validate(file, null);
    if (err) {
      dispatch({ type: "set_validation_error", error: err });
      return;
    }
    dispatch({ type: "set_file", file });
  }, []);

  const onDuration = React.useCallback((_duration: number) => {
    dispatch({ type: "set_duration", duration: _duration });
  }, []);

  // Re-validate when duration arrives (CORE-03).
  React.useEffect(() => {
    if (!state.file || state.duration == null) return;
    const err = validate(state.file, state.duration);
    dispatch({ type: "set_validation_error", error: err });
  }, [state.file, state.duration]);

  const onSubmit = React.useCallback(async () => {
    if (!state.file || state.validationError) return;
    try {
      // AUTH-01: lazy anonymous bootstrap — ensures a valid JWT before any job is created.
      // ensureAnonymousSession() is idempotent: returns the existing user.id if already signed in.
      // [Cited: 04-PATTERNS.md "anonymous.ts"; 04-CONTEXT.md AUTH-01]
      await ensureAnonymousSession();

      const result = await submitJob(state.file, state.options, {
        onProgress: (sent, total) => {
          const pct = total > 0 ? (sent / total) * 100 : 0;
          dispatch({ type: "set_upload_pct", pct });
        },
        onSuccess: () => {
          dispatch({ type: "set_upload_pct", pct: 100 });
        },
        onError: (err) => {
          dispatch({ type: "submit_error", error: err.message });
        },
      });
      tusHandleRef.current = result.uploadHandle ?? null;
      // Keep the File ref in the Zustand store for the editor to pick up (D-14).
      setFileRef(result.jobId, state.file);
      dispatch({ type: "submit_start", jobId: result.jobId });
    } catch (err) {
      dispatch({
        type: "submit_error",
        error: err instanceof Error ? err.message : "Submit failed",
      });
    }
  }, [state.file, state.options, state.validationError, setFileRef]);

  const onCancel = React.useCallback(async () => {
    dispatch({ type: "cancel_start" });
    // Fire-and-forget abort per RESEARCH §Pattern 3 line 521.
    if (tusHandleRef.current) {
      void tusHandleRef.current.abort();
      tusHandleRef.current = null;
    }
    // DELETE /jobs/{id}
    if (state.jobId) {
      try {
        await fetch(`${env.NEXT_PUBLIC_BACKEND_URL}/jobs/${state.jobId}`, {
          method: "DELETE",
        });
      } catch {
        // Mock + real backends may differ; in mock mode the MSW handler emits
        // status='cancelling' → 'cancelled' Realtime updates which drive reducer
        // back to idle.
      }
    }
  }, [state.jobId]);

  // ETA estimation (UI-SPEC §13.1) — naive: duration_min × preset_factor
  const eta = React.useMemo(() => {
    if (!state.duration) return undefined;
    const factor =
      state.options.preset === "fast"
        ? 0.1
        : state.options.preset === "slow"
          ? 1.4
          : 0.33;
    const minutes = Math.max(1, Math.round((state.duration / 60) * factor));
    return `~${minutes} min`;
  }, [state.duration, state.options.preset]);

  // RENDER — landing branch
  if (state.phase === "idle") {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateRows: "1fr auto",
          minHeight: "calc(100dvh - 64px)",
          padding: "48px 24px 24px",
          position: "relative",
          zIndex: 2,
        }}
      >
        <div className="flex flex-col items-center">
          <LandingHero />
          <UploadZone
            file={state.file}
            onFile={onFile}
            onClear={() => dispatch({ type: "clear_file" })}
            onDuration={onDuration}
            duration={state.duration}
            validationError={state.validationError}
            className="w-full max-w-[720px] mt-8"
          />
          <OptionsPanel
            options={state.options}
            onChange={(o) => dispatch({ type: "set_options", options: o })}
            className="w-full max-w-[720px] mt-3.5"
          />
          <div className="flex items-center gap-3 mt-[22px]">
            <Button
              variant="primary"
              onClick={onSubmit}
              disabled={!state.file || !!state.validationError}
              aria-label="Start transcription"
              className="h-10 px-[22px] text-[14px]"
            >
              Start transcription →
            </Button>
            {eta ? (
              <span style={{ fontSize: 11.5, color: "var(--color-fg-3)" }}>
                estimated {eta} on home GPU
              </span>
            ) : null}
          </div>
        </div>
        <LandingFooter />
      </div>
    );
  }

  // RENDER — processing/queued/failed branches
  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        padding: "32px 24px",
        minHeight: "calc(100dvh - 64px)",
        position: "relative",
        zIndex: 2,
      }}
    >
      <ProcessingCard
        file={state.file}
        duration={state.duration}
        phase={
          state.phase as
            | "uploading"
            | "queued"
            | "transcribing"
            | "diarizing"
            | "merging"
            | "done"
            | "failed"
            | "cancelling"
        }
        uploadPct={state.uploadPct}
        progress={state.progress}
        jobId={state.jobId ?? ""}
        eta={eta}
        queueAhead={state.queueAhead}
        error={state.error}
        onCancel={onCancel}
      />
    </div>
  );
}
