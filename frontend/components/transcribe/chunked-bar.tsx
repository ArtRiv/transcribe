"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface ChunkedBarProps {
  /** 0-100 */
  pct: number;
  /** When true, all 64 blocks fill without head shimmer. */
  done: boolean;
  className?: string;
}

/** 64 discrete blocks; head block shimmers when active.
 *  Verbatim port from processing.jsx lines 308-329. */
export function ChunkedBar({ pct, done, className }: ChunkedBarProps) {
  const TOTAL = 64;
  const filled = Math.min(TOTAL, Math.max(0, Math.floor((pct / 100) * TOTAL)));
  // The head is the rightmost filled block when uploading is in progress.
  const headIndex = done ? -1 : filled - 1;

  return (
    <div
      className={cn("flex gap-[2px]", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label="Upload progress"
      style={{ height: 10 }}
    >
      {Array.from({ length: TOTAL }).map((_, i) => {
        const isFilled = i < filled;
        const isHead = i === headIndex;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              flex: 1,
              height: "100%",
              borderRadius: 1.5,
              background: isFilled ? "var(--color-accent)" : "var(--color-bg-3)",
              opacity: isHead ? 0.7 : 1,
              transition: "background 150ms",
              animation: isHead ? "barShimmer 1s ease-in-out infinite alternate" : "none",
            }}
          />
        );
      })}
    </div>
  );
}
