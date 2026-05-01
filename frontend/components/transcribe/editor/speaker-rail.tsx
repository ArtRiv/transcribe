"use client";
import * as React from "react";
import { Plus, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditableText } from "./editable-text";
import type { Speaker, Segment, EditorAction } from "@/lib/editor/reducer";
import { useI18n, format } from "@/lib/i18n/i18n-context";

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
  const { t } = useI18n();
  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const seg of segments)
      m.set(seg.speaker, (m.get(seg.speaker) ?? 0) + 1);
    return m;
  }, [segments]);

  return (
    <aside
      className={className}
      aria-label={t.editor_speakers}
      style={{
        // Fixed width so contents do NOT reflow while the parent grid column
        // animates from 240→0 (or back). The grid wrapper hides overflow,
        // so the aside is clipped rather than squeezed; the helper card's
        // text stays character-for-character identical through the
        // transition. Item line 34 of Things-to-change.txt.
        width: 240,
        padding: 14,
        borderRight: "1px solid var(--color-line)",
        background: "var(--color-bg-1)",
        overflow: "auto",
        boxSizing: "border-box",
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
        {t.editor_speakers} · {speakers.length}
      </div>

      <ul
        role="list"
        style={{ display: "flex", flexDirection: "column", gap: 4 }}
      >
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
              {(() => {
                const n = counts.get(sp.id) ?? 0;
                return n === 1
                  ? t.editor_segments_count_one
                  : format(t.editor_segments_count_n, { n });
              })()}
            </div>
          </li>
        ))}
      </ul>

      <Button
        variant="ghost"
        size="sm"
        className="mt-3"
        onClick={() => dispatch({ type: "add_speaker" })}
        aria-label={t.editor_add_speaker}
      >
        <Plus size={14} aria-hidden /> {t.editor_add_speaker}
      </Button>

      {/* Helper card — UI-SPEC §13.3 verbatim copy.
          width: 100% of the now-fixed-width aside, so the text wraps the
          same way at every animation frame (the prior dynamic width caused
          per-frame re-wrap that the user perceived as letter shimmer —
          item line 34 of Things-to-change.txt). */}
      <div
        style={{
          marginTop: 16,
          padding: 10,
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box",
          border: "1px dashed var(--color-line-soft)",
          borderRadius: "var(--radius-md)",
          fontSize: 11.5,
          color: "var(--color-fg-3)",
          lineHeight: 1.5,
          whiteSpace: "normal",
        }}
      >
        <div
          className="flex items-center gap-1.5 mb-1"
          style={{ color: "var(--color-fg-2)" }}
        >
          <Info size={12} aria-hidden /> {t.editor_renames_global_title}
        </div>
        {t.editor_renames_global_body}
      </div>
    </aside>
  );
}
