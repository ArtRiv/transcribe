"use client";
import * as React from "react";
import type { EditorState } from "@/lib/editor/reducer";
import type { SaveStatus } from "@/lib/editor/persist";

interface EditorFooterProps {
  state: EditorState;
  saveStatus: SaveStatus;
  className?: string;
}

function fmtAgo(seconds: number): string {
  if (seconds < 1) return "just now";
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function EditorFooter({ state, saveStatus, className }: EditorFooterProps) {
  const wordCount = React.useMemo(
    () =>
      state.segments.reduce(
        (n, seg) => n + seg.text.split(/\s+/).filter(Boolean).length,
        0,
      ),
    [state.segments],
  );

  // Tick every second so "Last saved Ns ago" updates live.
  const [, force] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const t = setInterval(force, 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <footer
      className={className}
      style={{
        height: 32,
        padding: "0 14px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderTop: "1px solid var(--color-line)",
        background: "var(--color-bg-1)",
        fontSize: 11.5,
        color: "var(--color-fg-3)",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div>
        {wordCount.toLocaleString()} words · {fmtDuration(state.duration_sec)} ·{" "}
        {state.segments.length} segments
      </div>
      <div className="flex items-center gap-2" role="status" aria-live="polite">
        {saveStatus.kind === "saved" ? (
          <>
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--color-ok)",
              }}
            />
            <span>
              Last saved{" "}
              {/* eslint-disable-next-line react-hooks/purity -- intentional: footer tick re-reads Date.now() each render; UI-SPEC §16.7 allows this for "saved Ns ago" */}
              {fmtAgo((Date.now() - saveStatus.at) / 1000)} · auto-save via
              localStorage
            </span>
          </>
        ) : saveStatus.kind === "error" ? (
          <span style={{ color: "var(--color-warn)" }}>
            ⚠ Saving locally failed — your edits are not persisted
          </span>
        ) : (
          <span>auto-save via localStorage</span>
        )}
      </div>
    </footer>
  );
}
