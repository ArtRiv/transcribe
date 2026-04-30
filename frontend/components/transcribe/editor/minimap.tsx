"use client";
import * as React from "react";
import type { Segment, Speaker } from "@/lib/editor/reducer";

interface MinimapProps {
  segments: Segment[];
  speakers: Speaker[];
  /** Current playback time in seconds — drives the playhead position. */
  playT: number;
  totalDuration: number;
  activeSegId: string | null;
  onJump: (seg: Segment) => void;
  className?: string;
}

/**
 * Right rail overview — segment stripes + 1.5px accent playhead (D-27).
 *
 * Stripe height = max(8, min(36, duration_s * 1.6)) per D-27 spec.
 * Speaker color cycles by index (D-05): var(--color-sp-{(idx % 5) + 1}).
 * Playhead is 1.5px accent line with glow, absolutely positioned on the stripe column.
 *
 * Spec: editor.jsx lines ~634-716.
 */
export function Minimap({
  segments,
  speakers,
  playT,
  totalDuration,
  activeSegId,
  onJump,
  className,
}: MinimapProps) {
  // Build a speaker-id → index map for O(1) color lookup.
  const speakerIndex = React.useMemo(() => {
    const m = new Map<string, number>();
    speakers.forEach((sp, i) => m.set(sp.id, i));
    return m;
  }, [speakers]);

  const playheadPct = totalDuration > 0 ? (playT / totalDuration) * 100 : 0;

  return (
    <aside
      className={className}
      aria-label="Overview"
      style={{
        padding: 12,
        borderLeft: "1px solid var(--color-line)",
        background: "var(--color-bg-1)",
        position: "relative",
        overflow: "auto",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--color-fg-3)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 12,
        }}
      >
        Overview
      </div>

      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 2 }}>
        {segments.map((seg) => {
          const duration = seg.end - seg.start;
          // D-27 formula: max(8, min(36, duration_s * 1.6))
          const height = Math.max(8, Math.min(36, duration * 1.6));
          const idx = speakerIndex.get(seg.speaker) ?? 0;
          const color = `var(--color-sp-${(idx % 5) + 1})`;
          const isActive = seg.id === activeSegId;

          return (
            <button
              key={seg.id}
              type="button"
              aria-label={`Jump to segment at ${Math.floor(seg.start)}s`}
              aria-pressed={isActive}
              onClick={() => onJump(seg)}
              style={{
                width: "100%",
                height,
                background: color,
                borderRadius: 2,
                border: isActive
                  ? "1px solid var(--color-accent)"
                  : "1px solid transparent",
                cursor: "pointer",
                opacity: isActive ? 1 : 0.85,
                transition: "opacity 150ms, border-color 150ms",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = isActive ? "1" : "0.85";
              }}
            />
          );
        })}

        {/* 1.5px accent playhead — D-27 + UI-SPEC §6 */}
        {totalDuration > 0 && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${playheadPct}%`,
              height: 1.5,
              background: "var(--color-accent)",
              boxShadow: "0 0 8px var(--color-accent)",
              transition: "top 100ms linear",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </aside>
  );
}
