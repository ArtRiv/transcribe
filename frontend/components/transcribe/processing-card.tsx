"use client";
import * as React from "react";
import { FileAudio } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChunkedBar } from "./chunked-bar";
import { PipelineStepper } from "./pipeline-stepper";
import { PhaseRow } from "./phase-row";
import { useI18n, format } from "@/lib/i18n/i18n-context";
import type { Messages } from "@/lib/i18n/types";
import type { SubmitErrorKind } from "@/lib/job/submit";

type Phase =
  | "uploading"
  | "queued"
  | "transcribing"
  | "diarizing"
  | "merging"
  | "done"
  | "failed"
  | "cancelling";

/** Discriminated error shape (item line 19 — typed errors). The legacy
 *  string form is still accepted from older callers + existing unit tests
 *  and is treated as kind=unknown. */
export type ProcessingError =
  | string
  | { kind: SubmitErrorKind | "pipeline"; detail: string }
  | null;

interface ProcessingCardProps {
  file: File | null;
  duration: number | null;
  phase: Phase;
  /** 0-100; only used when phase === 'uploading' */
  uploadPct: number;
  /** 0-100; backend progress for transcribing/diarizing/merging */
  progress: number;
  jobId: string;
  eta?: string;
  /** Number of jobs ahead in the queue when phase === 'queued' (PROG-04). */
  queueAhead?: number;
  error?: ProcessingError;
  onCancel: () => void;
  className?: string;
}

function fmtSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`;
}

function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Resolve PhaseRow content per UI-SPEC §10.4 stage mapping.
 *  Pure function of state + locale catalog — keeps phaseRowContent unit-
 *  testable without mounting an I18nProvider. Existing tests pass an English
 *  catalog (or the default exported EN_MESSAGES) to keep assertions stable. */
function phaseRowContent(
  props: {
    phase: Phase;
    progress: number;
    uploadPct: number;
    queueAhead: number;
    error?: ProcessingError;
  },
  t: Messages,
): {
  title: string;
  detail: string;
  pct?: number;
  pulse?: boolean;
  done?: boolean;
  error?: boolean;
} {
  const { phase, progress, uploadPct, queueAhead, error } = props;

  if (phase === "failed") {
    // Pick a localized title per error.kind. Legacy string-only callers
    // (older tests) fall through to the default "Transcription failed" title.
    const e =
      typeof error === "string"
        ? { kind: "unknown" as const, detail: error }
        : (error ?? { kind: "unknown" as const, detail: "" });
    const title =
      e.kind === "backend-unreachable"
        ? t.err_backend_unreachable_title
        : e.kind === "auth-failed"
          ? t.err_auth_failed_title
          : e.kind === "upload-failed"
            ? t.err_upload_failed_title
            : e.kind === "validation-failed"
              ? t.err_validation_failed_title
              : e.kind === "pipeline"
                ? t.err_pipeline_failed_title
                : t.phase_failed_title;
    return {
      title,
      detail: e.detail || t.err_unknown_body,
      error: true,
    };
  }
  if (phase === "cancelling") {
    return {
      title: t.phase_cancelling_title,
      detail: t.phase_cancelling_detail,
      pulse: true,
    };
  }
  if (phase === "uploading") {
    return {
      title: t.phase_uploading_title,
      detail: t.phase_uploading_detail,
      pct: uploadPct,
    };
  }
  if (phase === "queued") {
    return {
      title: t.phase_queued_title,
      detail:
        queueAhead > 0
          ? queueAhead === 1
            ? t.phase_queued_jobs_ahead_one
            : format(t.phase_queued_jobs_ahead_n, { n: queueAhead })
          : t.phase_queued_waiting_for_gpu,
      pulse: true,
    };
  }
  if (phase === "transcribing") {
    return {
      title: t.phase_transcribing_title,
      detail: format(t.phase_transcribing_detail, {
        pct: Math.floor(progress),
      }),
      pct: progress,
    };
  }
  if (phase === "diarizing") {
    return {
      title: t.phase_diarizing_title,
      detail: t.phase_diarizing_detail,
      pct: progress,
    };
  }
  if (phase === "merging") {
    return {
      title: t.phase_merging_title,
      detail: t.phase_merging_detail,
      pct: progress,
    };
  }
  // done
  return {
    title: t.phase_done_title,
    detail: t.phase_done_detail,
    done: true,
  };
}

/** Processing screen primary surface — UI-SPEC §9.3. */
export function ProcessingCard({
  file,
  duration,
  phase,
  uploadPct,
  progress,
  jobId,
  eta,
  queueAhead = 0,
  error,
  onCancel,
  className,
}: ProcessingCardProps) {
  const { t } = useI18n();
  const content = phaseRowContent(
    { phase, progress, uploadPct, queueAhead, error },
    t,
  );
  const showChunkedBar = phase === "uploading";

  return (
    <div
      className={className}
      style={{
        display: "grid",
        gap: 14,
        justifyItems: "center",
        width: "100%",
      }}
    >
      {/* File header card — processing.jsx lines 69-112 */}
      {file ? (
        <Card style={{ width: "min(720px, 100%)", padding: "18px 20px" }}>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center shrink-0"
              style={{
                width: 42,
                height: 42,
                background: "var(--color-bg-3)",
                border: "1px solid var(--color-line)",
                borderRadius: 10,
                color: "var(--color-accent)",
              }}
            >
              <FileAudio size={20} aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <div
                className="truncate"
                style={{ color: "var(--color-fg-0)", fontWeight: 500 }}
              >
                {file.name}
              </div>
              <div
                className="mono"
                style={{
                  color: "var(--color-fg-3)",
                  fontSize: 11.5,
                  marginTop: 3,
                }}
              >
                {fmtSize(file.size)}
                {duration != null ? ` · ${fmtDuration(duration)}` : ""}
              </div>
            </div>
            {eta ? (
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 11.5, color: "var(--color-fg-3)" }}>
                  {t.processing_est_remaining}
                </div>
                <div
                  className="mono"
                  style={{
                    fontSize: 13,
                    color: "var(--color-fg-0)",
                    fontWeight: 500,
                    marginTop: 2,
                  }}
                >
                  {eta}
                </div>
              </div>
            ) : null}
          </div>

          {showChunkedBar ? (
            <div style={{ marginTop: 14 }}>
              <ChunkedBar pct={uploadPct} done={uploadPct >= 100} />
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  color: "var(--color-fg-3)",
                  marginTop: 7,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>
                  {uploadPct >= 100
                    ? t.upload_complete
                    : format(t.upload_chunk_n_of_64, {
                        n: Math.min(64, Math.ceil(uploadPct / 1.6)),
                      })}
                </span>
                <span>{Math.round(uploadPct)}%</span>
              </div>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* Pipeline card — processing.jsx lines 114-225 */}
      <Card style={{ width: "min(720px, 100%)", padding: "22px 24px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "var(--color-fg-0)",
            }}
          >
            {t.pipeline_label}
          </div>
          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--color-fg-3)" }}
          >
            job_{jobId.slice(0, 8)} · home-gpu-01
          </div>
        </div>
        <PipelineStepper currentStage={phase} />
        <div style={{ marginTop: 24 }}>
          <PhaseRow {...content} />
        </div>
      </Card>

      {/* Cancel — UI-SPEC §10.5.
          In phase=failed we enable the button and relabel it "Back to upload"
          (item line 21 of Things-to-change.txt) so the user has a way out
          when the pipeline screen reports an error. */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={phase === "done" || phase === "cancelling"}
        aria-label={
          phase === "failed" ? t.cancel_back_to_upload : t.cancel_aria
        }
        style={{ color: "var(--color-fg-3)" }}
      >
        {phase === "failed" ? t.cancel_back_to_upload : t.cancel_job}
      </Button>
    </div>
  );
}
