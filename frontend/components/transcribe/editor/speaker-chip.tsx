"use client";
import * as React from "react";
import type { Speaker } from "@/lib/editor/reducer";

interface SpeakerChipProps {
  speaker: Speaker;
  /** Index in EditorState.speakers[] — drives D-05 color cycle by ARRAY POSITION. */
  speakerIndex: number;
  small?: boolean;
}

/**
 * Speaker dot + name chip.
 * Color cycles by index (D-05): speakerIndex % 5 + 1 → --color-sp-1..5.
 * NOT based on a hash of the speaker id.
 *
 * Spec: editor.jsx lines 404-425.
 */
export function SpeakerChip({ speaker, speakerIndex, small }: SpeakerChipProps) {
  const color = `var(--color-sp-${(speakerIndex % 5) + 1})`;
  return (
    <span
      role="img"
      aria-label={speaker.label}
      className="inline-flex items-center gap-1.5"
      style={{ fontSize: small ? 11 : 12.5, color: "var(--color-fg-1)" }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span>{speaker.label}</span>
    </span>
  );
}
