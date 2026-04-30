"use client";
import * as React from "react";
import { DoneCheck } from "./done-check";

interface PhaseRowProps {
  title: string;
  detail: string;
  /** 0-100; omit to render without a bar. */
  pct?: number;
  /** When true, show a pulsing dot beside the title (queued state). */
  pulse?: boolean;
  /** When true, render in --color-err and suppress the progress bar (CORE-09). */
  error?: boolean;
  /** When true, render the DoneCheck SVG instead of a progress bar. */
  done?: boolean;
  className?: string;
}

/** Active phase detail — UI-SPEC §10.4 + §11 error/loading/empty contract.
 *  Port from processing.jsx lines 256-305. */
export function PhaseRow({ title, detail, pct, pulse, error, done, className }: PhaseRowProps) {
  const showBar = !error && !done && typeof pct === "number";
  return (
    <div
      className={className}
      style={{
        padding: "14px 16px",
        background: "var(--color-bg-1)",
        border: "1px solid var(--color-line-soft)",
        borderRadius: 10,
        minHeight: 64,
      }}
    >
      {/* Title row */}
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}
        role="status"
        aria-live="polite"
      >
        <div style={{ fontSize: 13, fontWeight: 500, color: error ? "var(--color-err)" : "var(--color-fg-0)" }}>
          {title}
          {pulse && (
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                marginLeft: 8,
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--color-accent)",
                animation: "ringPulse 1.4s ease-in-out infinite",
              }}
            />
          )}
        </div>
        {showBar && (
          <div
            className="mono"
            style={{ fontSize: 11.5, color: "var(--color-fg-3)" }}
            aria-hidden="true"
          >
            {Math.round(pct!)}%
          </div>
        )}
      </div>

      {/* Detail text */}
      <div
        style={{
          fontSize: 11.5,
          color: error ? "var(--color-err)" : "var(--color-fg-3)",
          marginTop: 4,
          fontFamily: error ? undefined : "var(--font-mono)",
        }}
      >
        {detail}
      </div>

      {/* Progress bar — only when active (not error, not done) */}
      {showBar && (
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct!)}
          aria-label={title}
          style={{
            marginTop: 10,
            height: 4,
            borderRadius: 999,
            background: "var(--color-bg-3)",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(100, Math.max(0, pct!))}%`,
              background: "var(--color-accent)",
              borderRadius: 999,
              transition: "width 220ms",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(90deg, transparent, oklch(1 0 0 / 0.35), transparent)",
                animation: "barShimmer 1.6s linear infinite",
              }}
              aria-hidden="true"
            />
          </div>
        </div>
      )}

      {/* Done check — DoneCheck SVG replaces bar when done */}
      {done && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <DoneCheck />
        </div>
      )}
    </div>
  );
}
