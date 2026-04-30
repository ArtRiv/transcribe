"use client";
import * as React from "react";

type StepKey = "uploading" | "queued" | "transcribing" | "diarizing" | "done";

interface Step {
  key: StepKey;
  label: string;
}

/** UI-SPEC §10.4 — 5 steps map; spec processing.jsx lines 51-57. */
const STEPS: readonly Step[] = [
  { key: "uploading", label: "Uploading" },
  { key: "queued", label: "Queued" },
  { key: "transcribing", label: "Transcribing" },
  { key: "diarizing", label: "Diarizing" },
  { key: "done", label: "Done" },
];

interface PipelineStepperProps {
  currentStage:
    | "uploading"
    | "queued"
    | "transcribing"
    | "diarizing"
    | "merging"
    | "done"
    | "failed"
    | "cancelling";
  className?: string;
}

/** UI-SPEC §10.4 reconciliation: backend `merging` collapses into UI `diarizing`. */
function reconcileStage(s: PipelineStepperProps["currentStage"]): StepKey {
  if (s === "merging") return "diarizing";
  if (s === "failed" || s === "cancelling") return "queued"; // hold step indicator at last good
  return s;
}

function stepState(idx: number, currentIdx: number): "pending" | "active" | "done" {
  if (idx < currentIdx) return "done";
  if (idx === currentIdx) return "active";
  return "pending";
}

export function PipelineStepper({ currentStage, className }: PipelineStepperProps) {
  const reconciled = reconcileStage(currentStage);
  const currentIdx = STEPS.findIndex((s) => s.key === reconciled);

  return (
    <ol
      className={className}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`,
        gap: 0,
        listStyle: "none",
        margin: 0,
        padding: 0,
      }}
      aria-label="Transcription pipeline progress"
    >
      {STEPS.map((step, i) => {
        const state = stepState(i, currentIdx);
        const isActive = state === "active";
        const isDone = state === "done";
        return (
          <li
            key={step.key}
            aria-current={isActive ? "step" : undefined}
            aria-label={`${step.label} — ${state}`}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              position: "relative",
            }}
          >
            {/* Connector line between steps */}
            {i < STEPS.length - 1 && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 14,
                  left: "calc(50% + 18px)",
                  right: "calc(-50% + 18px)",
                  height: 1.5,
                  background: isDone ? "var(--color-accent)" : "var(--color-line)",
                  transition: "background 300ms",
                }}
              />
            )}
            <span
              aria-hidden="true"
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: isDone
                  ? "var(--color-accent)"
                  : isActive
                    ? "var(--color-accent-soft)"
                    : "var(--color-bg-3)",
                color: isDone
                  ? "oklch(0.20 0.020 70)"
                  : isActive
                    ? "var(--color-accent)"
                    : "var(--color-fg-4)",
                border: isActive
                  ? "1.5px solid var(--color-accent)"
                  : `1.5px solid ${isDone ? "var(--color-accent)" : "var(--color-line)"}`,
                transition: "background 300ms, border-color 300ms, color 300ms",
                animation: isActive ? "ringPulse 1.6s ease-in-out infinite" : "none",
              }}
            >
              {isDone ? (
                /* Simple checkmark for done steps */
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 15 15"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 7.5 L6.5 11 L12 5"
                    stroke="oklch(0.20 0.020 70)"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: isActive ? "var(--color-accent)" : "var(--color-fg-4)",
                  }}
                />
              )}
            </span>
            <span
              style={{
                marginTop: 9,
                fontSize: 11.5,
                color: isActive
                  ? "var(--color-fg-0)"
                  : isDone
                    ? "var(--color-fg-2)"
                    : "var(--color-fg-4)",
                fontWeight: isActive ? 600 : 500,
              }}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
