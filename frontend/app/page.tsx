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
import {
  submitJob,
  SubmitError,
  type JobOptions,
  type SubmitErrorKind,
} from "@/lib/job/submit";
import { subscribeToJob, type JobRow } from "@/lib/supabase/realtime-client";
import { useEditorStore } from "@/lib/editor/store";
import { env } from "@/lib/env";
import { ensureAnonymousSession } from "@/lib/auth/anonymous";
import { useI18n } from "@/lib/i18n/i18n-context";

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

/** Discriminated error union surfaced in PageState. */
export interface PageErrorState {
  kind: SubmitErrorKind | "pipeline";
  detail: string;
}

interface PageState {
  phase: Phase;
  file: File | null;
  duration: number | null;
  options: JobOptions;
  jobId: string | null;
  uploadPct: number;
  progress: number;
  queueAhead: number;
  /** Typed error so ProcessingCard can pick a localized title (item line 19
   *  of Things-to-change.txt — "show me what's actually going on"). The
   *  string-only fallback before the quick-task pass produced "Unknown
   *  error" for every backend-down case. */
  error: PageErrorState | null;
  validationError: string | null;
  /** Set true at the top of onSubmit and false only on error.
   *  While true the Start button is disabled and reads "Starting…" so a
   *  rapid second click cannot fire a second POST /jobs (item line 23 of
   *  Things-to-change.txt). The success path transitions to phase='uploading'
   *  which already takes the idle render off-screen. */
  submitting: boolean;
}

type PageAction =
  | { type: "set_file"; file: File }
  | { type: "clear_file" }
  | { type: "set_duration"; duration: number }
  | { type: "set_options"; options: JobOptions }
  | { type: "set_validation_error"; error: string | null }
  | { type: "submitting" }
  | { type: "submit_start"; jobId: string }
  | { type: "set_upload_pct"; pct: number }
  | { type: "realtime_update"; row: JobRow; queueAhead: number }
  | { type: "submit_error"; error: PageErrorState }
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
  submitting: false,
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
    case "submitting":
      return { ...s, submitting: true, error: null };
    case "submit_start":
      return {
        ...s,
        phase: "uploading",
        jobId: a.jobId,
        uploadPct: 0,
        progress: 0,
        error: null,
        // Once we've transitioned to the processing screen the idle button is
        // off-screen, so flipping submitting back is harmless and tidy.
        submitting: false,
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
          // Backend pipeline failures (whisper.cpp crash, ffmpeg fail, etc.)
          // map to the "pipeline" kind so ProcessingCard renders the generic
          // pipeline-failed title plus the raw detail line.
          error: { kind: "pipeline", detail: row.error ?? "" },
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
      return { ...s, phase: "failed", error: a.error, submitting: false };
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
      // Preserve the file/duration/options so Cancel-from-failed (Task 5 / item
      // line 21) returns the user to the upload screen with their file still
      // selected — they can tweak options or just retry without re-picking.
      return {
        ...initialState,
        file: s.file,
        duration: s.duration,
        options: s.options,
      };
  }
}

/** Validate file pre-submit (CORE-03).
 *  Mirror backend/app/routes/tus.py + jobs.py ALLOWED_EXTENSIONS — keep this
 *  list byte-identical to the backend, otherwise users hit the dropzone-accept
 *  path with a file the server will reject (item line 5 of Things-to-change.txt). */
const ALLOWED_EXTS = new Set([
  "mp3",
  "m4a",
  "wav",
  "flac",
  "ogg",
  "aac",
  "mpga",
  "mp4",
  "mkv",
  "webm",
  "mov",
  "avi",
]);
const MAX_DURATION_SEC = 5 * 60 * 60; // 5 hours
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

function validate(file: File, duration: number | null): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTS.has(ext)) {
    return `${file.name} isn't a supported audio or video file. Try mp3, m4a, wav, flac, ogg, aac, mp4, mkv, webm, mov, or avi.`;
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
  const { t } = useI18n();
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
    if (!state.file || state.validationError || state.submitting) return;
    // Flip submitting=true synchronously BEFORE any await so a rapid second click
    // (the user's Things-to-change.txt line 23 report) hits the disabled button.
    dispatch({ type: "submitting" });
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
          dispatch({
            type: "submit_error",
            error:
              err instanceof SubmitError
                ? { kind: err.kind, detail: err.message }
                : { kind: "unknown", detail: err.message },
          });
        },
      });
      tusHandleRef.current = result.uploadHandle ?? null;
      // Keep the File ref in the Zustand store for the editor to pick up (D-14).
      setFileRef(result.jobId, state.file);
      dispatch({ type: "submit_start", jobId: result.jobId });
    } catch (err) {
      dispatch({
        type: "submit_error",
        error:
          err instanceof SubmitError
            ? { kind: err.kind, detail: err.message }
            : {
                kind: "unknown",
                detail: err instanceof Error ? err.message : String(err),
              },
      });
    }
  }, [
    state.file,
    state.options,
    state.validationError,
    state.submitting,
    setFileRef,
  ]);

  const onCancel = React.useCallback(async () => {
    // Item line 21 of Things-to-change.txt: "when it shows the error in the
    // transcription pipeline screen, I cant go back because the cancel button
    // is disabled". Fix: in the failed state Cancel becomes "Back to upload"
    // and short-circuits to a reset (the upload + DELETE /jobs both already
    // failed, so trying again would just produce another error).
    if (state.phase === "failed") {
      dispatch({ type: "reset" });
      return;
    }
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
  }, [state.jobId, state.phase]);

  // ETA estimation (item line 17 of Things-to-change.txt — the original naive
  // formula bottomed out at "~1 min" for every clip <3 min, so a 30s sample
  // and a 3-min meeting both reported the same number).
  //
  // Realtime factors per .planning/research/SUMMARY.md "Quality / Speed Presets":
  //   fast (small):           ~30× realtime  → ASR factor = 1/30 ≈ 0.033
  //   average (large-v3-turbo): ~45× realtime → ASR factor = 1/45 ≈ 0.022
  //   slow (large-v3):        ~15× realtime  → ASR factor = 1/15 ≈ 0.067
  // Diarization runs on CPU (D-04) and adds ~0.5× realtime when enabled.
  // The result scales linearly with duration AND switches with diarize, so
  // a 30s clip with diarize=on shows "~15 s" while a 3-min clip shows "~2 min".
  const eta = React.useMemo(() => {
    if (!state.duration) return undefined;
    const asrFactor =
      state.options.preset === "fast"
        ? 1 / 30
        : state.options.preset === "slow"
          ? 1 / 15
          : 1 / 45;
    const asrSec = state.duration * asrFactor;
    const diarSec = state.options.diarize ? state.duration * 0.5 : 0;
    const totalSec = Math.max(5, asrSec + diarSec);
    if (totalSec < 60) return `~${Math.round(totalSec)} s`;
    return `~${Math.max(1, Math.round(totalSec / 60))} min`;
  }, [state.duration, state.options.preset, state.options.diarize]);

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
              disabled={
                !state.file || !!state.validationError || state.submitting
              }
              aria-label={t.start_transcription_aria}
              aria-busy={state.submitting || undefined}
              className="h-10 px-[22px] text-[14px] cursor-pointer disabled:cursor-not-allowed"
            >
              {state.submitting
                ? t.start_transcription_starting
                : t.start_transcription}
            </Button>
            {eta ? (
              <span style={{ fontSize: 11.5, color: "var(--color-fg-3)" }}>
                {t.estimated_prefix}
                {eta}
                {t.estimated_suffix}
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
