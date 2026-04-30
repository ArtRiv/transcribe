import type { EditorState } from "@/lib/editor/reducer";
import { fmtVttTime } from "./time";
import type { ExportOptions } from "./txt";
import { formatName } from "./txt";

export function renderVtt(state: EditorState, opts: ExportOptions): string {
  const map = new Map(state.speakers.map((sp) => [sp.id, sp] as const));
  const body = state.segments
    .map((seg) => {
      const range = `${fmtVttTime(seg.start)} --> ${fmtVttTime(seg.end)}`;
      const cue = opts.includeSpeakers ? `<v ${formatName(map.get(seg.speaker)?.label, opts.speakerNameFmt)}>` : "";
      return `${range}\n${cue}${seg.text}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${body}`;
}
