import type { EditorState } from "@/lib/editor/reducer";
import { fmtTime } from "./time";
import type { ExportOptions } from "./txt";
import { formatName } from "./txt";

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Optional H1 title — Phase 3 doesn't store this on EditorState yet; pass via opts.title later. */
export function renderMd(state: EditorState, opts: ExportOptions, title?: string): string {
  const map = new Map(state.speakers.map((sp) => [sp.id, sp] as const));
  const lines: string[] = [];
  if (title?.trim()) lines.push(`# ${title.trim()}\n`);
  lines.push(`_${state.speakers.length} speakers · ${fmtDuration(state.duration_sec)} · ${state.segments.length} segments_\n`);
  lines.push("---\n");
  for (const seg of state.segments) {
    const parts: string[] = [];
    if (opts.includeTimestamps) parts.push(`\`${fmtTime(seg.start)}\` ·`);
    if (opts.includeSpeakers) parts.push(`**${formatName(map.get(seg.speaker)?.label, opts.speakerNameFmt)}**`);
    if (parts.length) lines.push(parts.join(" "));
    lines.push(seg.text + "\n");
  }
  return lines.join("\n");
}
