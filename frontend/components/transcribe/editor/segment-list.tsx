"use client";
import * as React from "react";
import { SegmentRow } from "./segment-row";
import type { Segment, Speaker, EditorAction } from "@/lib/editor/reducer";

interface SegmentListProps {
  segments: Segment[];
  speakers: Speaker[];
  density: "compact" | "normal" | "comfortable";
  activeSegId: string | null;
  searchQuery: string;
  dispatch: (action: EditorAction) => void;
  /** VIEW-05: click-to-seek — notifies parent to scrub audio to segment start. */
  onSegmentClick: (seg: Segment) => void;
}

/**
 * Filtered + memoized list of segment rows.
 *
 * - Filters segments by text.toLowerCase().includes(query.toLowerCase()).
 * - Empty-state renders "No segments match \"{q}\"." (UI-SPEC §11).
 * - Speaker map memoized to avoid O(n²) lookups per segment.
 *
 * Spec: editor.jsx lines 280-400.
 */
export function SegmentList({
  segments,
  speakers,
  density,
  activeSegId,
  searchQuery,
  dispatch,
  onSegmentClick,
}: SegmentListProps) {
  // Memoize speaker lookup map to avoid O(n) per segment (Anti-Pattern line 1018).
  const speakerMap = React.useMemo(
    () =>
      new Map(
        speakers.map((sp, idx) => [sp.id, { speaker: sp, idx }] as const),
      ),
    [speakers],
  );

  // Filter segments by search query (case-insensitive).
  const filtered = React.useMemo(() => {
    if (!searchQuery.trim()) return segments;
    const q = searchQuery.toLowerCase();
    return segments.filter((seg) => seg.text.toLowerCase().includes(q));
  }, [segments, searchQuery]);

  if (filtered.length === 0) {
    return (
      <div
        role="status"
        style={{
          padding: 32,
          textAlign: "center",
          color: "var(--color-fg-3)",
          fontSize: 13,
          border: "1px dashed var(--color-line)",
          borderRadius: 12,
        }}
      >
        {searchQuery.trim()
          ? `No segments match "${searchQuery}".`
          : "No segments yet — the transcription returned an empty payload."}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {filtered.map((seg) => {
        const lookup = speakerMap.get(seg.speaker);
        return (
          <SegmentRow
            key={seg.id}
            segment={seg}
            speaker={lookup?.speaker}
            speakerIndex={lookup?.idx ?? 0}
            speakers={speakers}
            isActive={seg.id === activeSegId}
            density={density}
            searchQuery={searchQuery}
            dispatch={dispatch}
            onClick={() => onSegmentClick(seg)}
          />
        );
      })}
    </div>
  );
}
