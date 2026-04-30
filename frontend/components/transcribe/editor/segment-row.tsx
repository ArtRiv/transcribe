"use client";
import * as React from "react";
import { EditableText } from "./editable-text";
import { SpeakerChip } from "./speaker-chip";
import { SegmentActions } from "./segment-actions";
import type { Segment, Speaker, EditorAction } from "@/lib/editor/reducer";

type Density = "compact" | "normal" | "comfortable";

const DENSITY: Record<
  Density,
  { padding: string; gap: number; fontSize: number; lineHeight: number }
> = {
  compact: { padding: "10px 12px", gap: 1, fontSize: 13.5, lineHeight: 1.55 },
  normal: { padding: "14px 12px", gap: 3, fontSize: 15, lineHeight: 1.62 },
  comfortable: { padding: "20px 14px", gap: 6, fontSize: 16, lineHeight: 1.7 },
};

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

interface SegmentRowProps {
  segment: Segment;
  speaker: Speaker | undefined;
  /** Index in EditorState.speakers[] — for D-05 color cycle. */
  speakerIndex: number;
  speakers: Speaker[];
  isActive: boolean;
  density: Density;
  searchQuery: string;
  dispatch: (action: EditorAction) => void;
  onClick: () => void;
}

/**
 * Per-segment surface — header (timestamps + speaker chip + actions) + EditableText body.
 *
 * Active segment receives:
 *   - bg --color-bg-2 (UI-SPEC §9.4)
 *   - 2.5px --color-accent border-left (UI-SPEC §9.4)
 *   - 1px --color-line border (UI-SPEC §9.4)
 *
 * Memoized to avoid re-render of every row on each keystroke
 * (RESEARCH §Anti-Patterns line 1018).
 *
 * Spec: editor.jsx lines 303-359.
 */
function SegmentRowImpl({
  segment,
  speaker,
  speakerIndex,
  speakers,
  isActive,
  density,
  searchQuery,
  dispatch,
  onClick,
}: SegmentRowProps) {
  const d = DENSITY[density];
  return (
    <div
      aria-current={isActive ? "true" : undefined}
      onClick={onClick}
      className="group/segment cursor-pointer transition-colors duration-150 rounded-(--radius-md)"
      style={{
        padding: d.padding,
        background: isActive ? "var(--color-bg-2)" : "transparent",
        border: `1px solid ${isActive ? "var(--color-line)" : "transparent"}`,
        borderLeftWidth: isActive ? "2.5px" : "1px",
        borderLeftColor: isActive ? "var(--color-accent)" : "transparent",
      }}
    >
      {/* Header row: timestamps + speaker chip + hover-revealed actions */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-3">
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-fg-3)",
              letterSpacing: "0.02em",
            }}
          >
            {fmtTime(segment.start)} → {fmtTime(segment.end)}
          </span>
          {speaker ? (
            <SpeakerChip speaker={speaker} speakerIndex={speakerIndex} small />
          ) : null}
        </div>
        <SegmentActions seg={segment} speakers={speakers} dispatch={dispatch} />
      </div>
      {/* Editable body text */}
      <EditableText
        text={segment.text}
        highlight={searchQuery}
        onChange={(text) =>
          dispatch({ type: "edit_text", segmentId: segment.id, text })
        }
        style={{
          fontSize: d.fontSize,
          lineHeight: d.lineHeight,
          letterSpacing: "-0.005em",
          color: "var(--color-fg-1)",
        }}
      />
    </div>
  );
}

export const SegmentRow = React.memo(SegmentRowImpl);
