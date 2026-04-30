"use client";
import * as React from "react";
import { Plus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditableText } from "./editable-text";
import type { Speaker, Segment, EditorAction } from "@/lib/editor/reducer";

interface SpeakerRailProps {
  speakers: Speaker[];
  segments: Segment[];
  activeSpeakerId?: string | null;
  dispatch: (action: EditorAction) => void;
  className?: string;
}

export function SpeakerRail({
  speakers,
  segments,
  activeSpeakerId,
  dispatch,
  className,
}: SpeakerRailProps) {
  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const seg of segments) m.set(seg.speaker, (m.get(seg.speaker) ?? 0) + 1);
    return m;
  }, [segments]);

  return (
    <aside
      className={className}
      aria-label="Speakers"
      style={{
        padding: 14,
        borderRight: "1px solid var(--color-line)",
        background: "var(--color-bg-1)",
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
        Speakers · {speakers.length}
      </div>

      <ul role="list" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {speakers.map((sp, idx) => (
          <li
            key={sp.id}
            aria-current={sp.id === activeSpeakerId ? "true" : undefined}
            style={{
              padding: "8px 8px",
              borderRadius: "var(--radius-md)",
              background:
                sp.id === activeSpeakerId ? "var(--color-bg-3)" : "transparent",
            }}
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: `var(--color-sp-${(idx % 5) + 1})`,
                  flexShrink: 0,
                }}
              />
              <EditableText
                text={sp.label}
                ariaLabel={`Speaker name: ${sp.label}`}
                onChange={(label) => {
                  if (!label.trim()) return; // empty rename is a no-op (UI-SPEC §10.7)
                  dispatch({ type: "rename_speaker", speakerId: sp.id, label });
                }}
                style={{ fontSize: 13, color: "var(--color-fg-0)", flex: 1 }}
              />
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-fg-3)",
                marginLeft: 15,
                fontFamily: "var(--font-mono)",
              }}
            >
              {counts.get(sp.id) ?? 0} segments
            </div>
          </li>
        ))}
      </ul>

      <Button
        variant="ghost"
        size="sm"
        className="mt-3"
        onClick={() => dispatch({ type: "add_speaker" })}
        aria-label="Add speaker"
      >
        <Plus size={14} aria-hidden /> Add speaker
      </Button>

      {/* Helper card — UI-SPEC §13.3 verbatim copy */}
      <div
        style={{
          marginTop: 16,
          padding: 10,
          border: "1px dashed var(--color-line-soft)",
          borderRadius: "var(--radius-md)",
          fontSize: 11.5,
          color: "var(--color-fg-3)",
          lineHeight: 1.5,
        }}
      >
        <div
          className="flex items-center gap-1.5 mb-1"
          style={{ color: "var(--color-fg-2)" }}
        >
          <Info size={12} aria-hidden /> Renames are global
        </div>
        Editing a speaker name updates every segment.
      </div>
    </aside>
  );
}
