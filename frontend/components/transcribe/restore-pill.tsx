"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";

interface RestorePillProps {
  savedAt: number;
  serverAt: number;
  onRestore: () => void;
  onDiscard: () => void;
}

function fmtRelative(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return new Date(ms).toLocaleString();
}

/** D-30 restore pill — UI-SPEC §13.3 copy.
 *  Only renders when savedAt > serverAt (local edits are newer than server). */
export function RestorePill({ savedAt, serverAt, onRestore, onDiscard }: RestorePillProps) {
  // Only render when saved is newer than server (D-30 condition).
  if (savedAt <= serverAt) return null;

  return (
    <div
      role="status"
      style={{
        margin: "12px auto",
        maxWidth: 720,
        padding: "8px 14px",
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-accent-line)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 12.5,
        color: "var(--color-fg-1)",
      }}
    >
      <span style={{ flex: 1 }}>
        We saved your edits from {fmtRelative(savedAt)}. Restore?
      </span>
      <Button variant="primary" size="sm" onClick={onRestore} aria-label="Restore saved edits">
        Restore
      </Button>
      <Button variant="ghost" size="sm" onClick={onDiscard} aria-label="Discard saved edits">
        Discard
      </Button>
    </div>
  );
}
