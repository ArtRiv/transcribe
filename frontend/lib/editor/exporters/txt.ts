import type { EditorState, Speaker } from "@/lib/editor/reducer";
import { fmtTime } from "./time";

export interface ExportOptions {
  includeSpeakers: boolean;
  includeTimestamps: boolean;
  speakerNameFmt: "initials" | "first" | "full";
}

export function formatName(label: string | undefined, fmt: ExportOptions["speakerNameFmt"]): string {
  if (!label) return "Speaker";
  if (fmt === "initials") return label.split(/\s+/).filter(Boolean).map((p) => p[0]).join(".");
  if (fmt === "first") return label.split(/\s+/)[0]!;
  return label;
}

function speakerLookup(speakers: Speaker[]): (id: string) => Speaker | undefined {
  const map = new Map(speakers.map((sp) => [sp.id, sp] as const));
  return (id) => map.get(id);
}

export function renderTxt(state: EditorState, opts: ExportOptions): string {
  const lookup = speakerLookup(state.speakers);
  return state.segments
    .map((seg) => {
      const head: string[] = [];
      if (opts.includeTimestamps) head.push(`[${fmtTime(seg.start)}]`);
      if (opts.includeSpeakers) head.push(`${formatName(lookup(seg.speaker)?.label, opts.speakerNameFmt)}:`);
      return (head.length ? head.join(" ") + " " : "") + seg.text;
    })
    .join("\n\n");
}
