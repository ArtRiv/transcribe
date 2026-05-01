"use client";
//
// Vertical scrollable timeline shown alongside the minimap when the
// transcript has exactly one speaker (item line 47 of Things-to-change.txt).
// The minimap stripes carry zero color information when there's only one
// speaker, so we trade that visual real estate for a wall-clock ruler the
// user can scroll through and click to seek.
//
// Layout:
//   - One column, full height of the right rail.
//   - Major ticks every 30 seconds (m:ss), minor ticks every 5 seconds.
//   - Segment ranges drawn as thin colored bands so users can spot dense
//     vs. sparse regions at a glance.
//   - 2 px playhead glows accent on the current playT.
//   - Click anywhere → seek to that time via onJump.
//
// The PX_PER_SEC density scales with the minimap's 1x/2x/3x picker so the
// two right-rail surfaces stay visually paired.

import * as React from "react";
import type { Segment } from "@/lib/editor/reducer";
import type { MinimapScale } from "./minimap";

interface TimelineProps {
  segments: Segment[];
  totalDuration: number;
  playT: number;
  scale: MinimapScale;
  onJump: (timeSec: number) => void;
  className?: string;
}

const BASE_PX_PER_SEC = 4; // 1x density: 4 px/sec ≈ 240 px per minute

export function Timeline({
  segments,
  totalDuration,
  playT,
  scale,
  onJump,
  className,
}: TimelineProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const PX_PER_SEC = BASE_PX_PER_SEC * scale;
  const totalPx = Math.max(200, totalDuration * PX_PER_SEC);

  // Smooth-scroll the playhead into view as audio plays. We center it in the
  // viewport so the user always sees ~half a screen of context on either
  // side. behavior:'smooth' is supported in evergreen Chrome/Firefox/Safari.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const targetTop = playT * PX_PER_SEC;
    el.scrollTo({
      top: Math.max(0, targetTop - el.clientHeight / 2),
      behavior: "smooth",
    });
  }, [playT, PX_PER_SEC]);

  // Every-30s major tick label set, computed once per duration change.
  const ticks = React.useMemo(() => {
    const arr: number[] = [];
    for (let t = 0; t <= totalDuration; t += 30) arr.push(t);
    return arr;
  }, [totalDuration]);

  return (
    <div
      ref={containerRef}
      aria-label="Timeline"
      className={className}
      style={{
        overflow: "auto",
        height: "100%",
        borderLeft: "1px solid var(--color-line)",
        padding: "12px 8px",
        background: "var(--color-bg-1)",
        position: "relative",
        scrollBehavior: "smooth",
        boxSizing: "border-box",
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const y = e.clientY - rect.top + e.currentTarget.scrollTop;
        const time = y / PX_PER_SEC;
        if (time >= 0 && time <= totalDuration) onJump(time);
      }}
    >
      <div style={{ position: "relative", height: totalPx, minHeight: 200 }}>
        {ticks.map((t) => (
          <div
            key={t}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: t * PX_PER_SEC,
              borderTop: "1px solid var(--color-line)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--color-fg-3)",
              paddingLeft: 4,
            }}
          >
            {Math.floor(t / 60)}:{String(t % 60).padStart(2, "0")}
          </div>
        ))}
        {segments.map((seg) => (
          <div
            key={seg.id}
            style={{
              position: "absolute",
              left: 32,
              right: 4,
              top: seg.start * PX_PER_SEC,
              height: Math.max(2, (seg.end - seg.start) * PX_PER_SEC),
              background: "var(--color-sp-1)",
              opacity: 0.6,
              borderRadius: 2,
            }}
          />
        ))}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: playT * PX_PER_SEC,
            height: 2,
            background: "var(--color-accent)",
            boxShadow: "0 0 8px var(--color-accent)",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
