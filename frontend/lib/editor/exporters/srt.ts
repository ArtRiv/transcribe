import type { EditorState } from "@/lib/editor/reducer";
import { fmtSrtTime } from "./time";
import type { ExportOptions } from "./txt";
import { formatName } from "./txt";

export function renderSrt(state: EditorState, opts: ExportOptions): string {
  const map = new Map(state.speakers.map((sp) => [sp.id, sp] as const));
  // SRT requires timestamps; UI-SPEC §9.5 locks the toggle on for SRT.
  // Defensive: ignore opts.includeTimestamps for this format.
  // Each SRT block: "{n}\n{start} --> {end}\n{text}\n\n" (trailing blank line per spec).
  return state.segments
    .map((seg, idx) => {
      const cueNo = idx + 1;
      const range = `${fmtSrtTime(seg.start)} --> ${fmtSrtTime(seg.end)}`;
      const prefix = opts.includeSpeakers ? `${formatName(map.get(seg.speaker)?.label, opts.speakerNameFmt)}: ` : "";
      return `${cueNo}\n${range}\n${prefix}${seg.text}\n\n`;
    })
    .join("");
}
