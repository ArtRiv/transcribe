"use client";
import * as React from "react";
import { FileAudio } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChunkedBar } from "./chunked-bar";
import { PipelineStepper } from "./pipeline-stepper";
import { PhaseRow } from "./phase-row";

type Phase =
  | "uploading"
  | "queued"
  | "transcribing"
  | "diarizing"
  | "merging"
  | "done"
  | "failed"
  | "cancelling";

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
  error?: string | null;
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

/** Resolve PhaseRow content per UI-SPEC §10.4 stage mapping. */
function phaseRowContent(props: {
  phase: Phase;
  progress: number;
  uploadPct: number;
  queueAhead: number;
  error?: string | null;
}): {
  title: string;
  detail: string;
  pct?: number;
  pulse?: boolean;
  done?: boolean;
  error?: boolean;
} {
  const { phase, progress, uploadPct, queueAhead, error } = props;

  if (phase === "failed") {
    return {
      title: "Transcription failed",
      detail: error ?? "Unknown error",
      error: true,
    };
  }
  if (phase === "cancelling") {
    return {
      title: "Cancelling…",
      detail: "Stopping the worker; partial output discarded",
      pulse: true,
    };
  }
  if (phase === "uploading") {
    return {
      title: "Uploading to home-gpu-01",
      detail: "Resumable chunked upload via Cloudflare Quick Tunnel",
      pct: uploadPct,
    };
  }
  if (phase === "queued") {
    return {
      title: "Queued",
      detail:
        queueAhead > 0
          ? `Waiting for GPU — ${queueAhead} ${queueAhead === 1 ? "job" : "jobs"} ahead`
          : "Waiting for GPU",
      pulse: true,
    };
  }
  if (phase === "transcribing") {
    return {
      title: "Transcribing with whisper.cpp",
      detail: `Realtime factor — · processed ${Math.floor(progress)}%`,
      pct: progress,
    };
  }
  if (phase === "diarizing") {
    return {
      title: "Diarizing with pyannote 3.4",
      detail: "Detected speakers · clustering segments",
      pct: progress,
    };
  }
  if (phase === "merging") {
    return {
      title: "Merging segments",
      detail: "Aligning words to speakers",
      pct: progress,
    };
  }
  // done
  return {
    title: "Done — opening editor",
    detail: "Loading transcript…",
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
  const content = phaseRowContent({ phase, progress, uploadPct, queueAhead, error });
  const showChunkedBar = phase === "uploading";

  return (
    <div
      className={className}
      style={{ display: "grid", gap: 14, justifyItems: "center", width: "100%" }}
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
                  est. remaining
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
                    ? "upload complete"
                    : `chunk ${Math.min(64, Math.ceil(uploadPct / 1.6))}/64`}
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
          <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-fg-0)" }}>
            Pipeline
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

      {/* Cancel — UI-SPEC §10.5 */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={phase === "done" || phase === "failed" || phase === "cancelling"}
        aria-label="Cancel job"
        style={{ color: "var(--color-fg-3)" }}
      >
        Cancel job
      </Button>
    </div>
  );
}
