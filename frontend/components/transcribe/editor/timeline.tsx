"use client";
//
// Vertical scrollable timeline shown alongside the minimap when the
// transcript has exactly one speaker.
//
// Behaviour fixes — items 13/14/16 of "things to change 2.txt":
//   • Click coords are read against the inner content (not the padded outer
//     wrapper), so the playhead lands at the click site instead of one
//     padding-row below the cursor.
//   • Press-and-drag scrubbing — pointer capture lets the user grab and
//     slide the playhead smoothly. mouseup or pointerleave commits the
//     final time. Suppresses the smooth-scroll auto-centering during
//     drag so the surface doesn't fight the user's pointer.
//   • Tick interval scales with audio length (5s → 10s → 30s → 60s) so
//     short clips show meaningful labels instead of just 0:00.

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

const BASE_PX_PER_SEC = 4;

function tickIntervalFor(duration: number): number {
  if (duration <= 0) return 30;
  if (duration < 60) return 5;
  if (duration < 300) return 10;
  if (duration < 1800) return 30;
  return 60;
}

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Timeline({
  segments,
  totalDuration,
  playT,
  scale,
  onJump,
  className,
}: TimelineProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const PX_PER_SEC = BASE_PX_PER_SEC * scale;
  const totalPx = Math.max(200, totalDuration * PX_PER_SEC);
  const tickStep = React.useMemo(
    () => tickIntervalFor(totalDuration),
    [totalDuration],
  );

  // Auto-scroll the playhead into view as audio plays — but only when the
  // user isn't actively dragging, otherwise the smooth-scroll fights the
  // pointer.
  React.useEffect(() => {
    if (dragging) return;
    const el = containerRef.current;
    if (!el) return;
    const targetTop = playT * PX_PER_SEC;
    el.scrollTo({
      top: Math.max(0, targetTop - el.clientHeight / 2),
      behavior: "smooth",
    });
  }, [playT, PX_PER_SEC, dragging]);

  const ticks = React.useMemo(() => {
    const arr: number[] = [];
    for (let t = 0; t <= totalDuration; t += tickStep) arr.push(t);
    return arr;
  }, [totalDuration, tickStep]);

  // Convert a pointer event to a time value, measured against the inner
  // content's bounding rect so the container's padding doesn't introduce
  // an offset (item 13 of "things to change 2.txt").
  const timeFromPointer = React.useCallback(
    (clientY: number): number | null => {
      const inner = contentRef.current;
      if (!inner) return null;
      const innerRect = inner.getBoundingClientRect();
      const y = clientY - innerRect.top;
      const time = y / PX_PER_SEC;
      if (time < 0) return 0;
      if (time > totalDuration) return totalDuration;
      return time;
    },
    [PX_PER_SEC, totalDuration],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    const time = timeFromPointer(e.clientY);
    if (time != null) onJump(time);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const time = timeFromPointer(e.clientY);
    if (time != null) onJump(time);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setDragging(false);
  };

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
        // No smooth scroll while the user is dragging — the JS-driven
        // jump-to-time works against an animated scrollLeft otherwise.
        scrollBehavior: dragging ? "auto" : "smooth",
        boxSizing: "border-box",
        cursor: dragging ? "grabbing" : "pointer",
        touchAction: "none",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={contentRef}
        style={{ position: "relative", height: totalPx, minHeight: 200 }}
      >
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
              pointerEvents: "none",
            }}
          >
            {fmtTime(t)}
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
              pointerEvents: "none",
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
