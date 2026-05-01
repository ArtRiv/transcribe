// Editor reducer — pure state machine for transcript edits.
//
// Action handlers port verbatim from
// frontend/claude-design-code/transcribe/src/editor.jsx lines 85-135 with
// React 19 + TypeScript adjustments. The split / merge_with_prev logic is
// load-bearing — keep the time-mid-point + word-half logic byte-identical
// to the spec.
//
// [Cited: RESEARCH §Code Examples; spec editor.jsx]

import type {
  TranscriptPayload,
  Speaker,
  Segment,
  Word,
} from "@/lib/mock/data";

/** Editor's internal state — extends TranscriptPayload (no new fields).
 *  This shape MUST be JSON-round-trippable so the json exporter (Plan 03-06)
 *  can serialise the current state directly into a backend-compatible payload. */
export type EditorState = TranscriptPayload;

/** Re-exported for consumers + tests. */
export type { Speaker, Segment, Word, TranscriptPayload };

export type EditorAction =
  | { type: "rename_speaker"; speakerId: string; label: string }
  | {
      type: "reassign_segment";
      segmentId: string;
      toSpeakerId: string;
      bulk?: boolean;
    }
  | { type: "edit_text"; segmentId: string; text: string }
  | {
      type: "split";
      segmentId: string;
      /** Optional offset into seg.text where the user's caret was when
       *  Split was clicked. When provided AND inside the text bounds, the
       *  reducer splits at that exact character (with leading/trailing
       *  whitespace trimmed for word boundaries) and computes the time
       *  proportionally. Item line 37 of Things-to-change.txt — the old
       *  fixed time-mid-point ignored where the user actually clicked. */
      caretIndex?: number;
    }
  | { type: "merge_with_prev"; segmentId: string }
  | { type: "delete"; segmentId: string }
  | { type: "add_speaker"; speaker?: Speaker }
  | { type: "restore"; state: EditorState };

/** Generate a fresh speaker id distinct from the existing set.
 *  Matches the spec's "Speaker N" id-by-index pattern (editor.jsx line 89). */
function nextSpeakerId(speakers: readonly Speaker[]): string {
  const existing = new Set(speakers.map((s) => s.id));
  let i = speakers.length;
  // Avoid collision if the user has deleted-and-readded such that
  // speaker.length doesn't match the next free index.
  while (existing.has(`S${i}`)) i++;
  return `S${i}`;
}

/** Default speaker label used when add_speaker omits a label. */
function defaultSpeakerLabel(speakers: readonly Speaker[]): string {
  return `Speaker ${speakers.length + 1}`;
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "rename_speaker": {
      // EDIT-01 / D-24: global rename — single source of truth in speakers[].
      // segments[] still references by id, so all SpeakerChip rows re-render
      // automatically with the new label.
      if (!a.label.trim()) return s; // empty rename is a no-op (UI-SPEC §10.7)
      return {
        ...s,
        speakers: s.speakers.map((sp) =>
          sp.id === a.speakerId ? { ...sp, label: a.label.trim() } : sp,
        ),
      };
    }

    case "reassign_segment": {
      // EDIT-02 (per-segment) / EDIT-03 (bulk merge per UI-SPEC §10.8).
      if (a.bulk) {
        const fromId = s.segments.find(
          (seg) => seg.id === a.segmentId,
        )?.speaker;
        if (!fromId || fromId === a.toSpeakerId) return s;
        return {
          ...s,
          speakers: s.speakers.filter((sp) => sp.id !== fromId),
          segments: s.segments.map((seg) =>
            seg.speaker === fromId ? { ...seg, speaker: a.toSpeakerId } : seg,
          ),
        };
      }
      return {
        ...s,
        segments: s.segments.map((seg) =>
          seg.id === a.segmentId ? { ...seg, speaker: a.toSpeakerId } : seg,
        ),
      };
    }

    case "edit_text": {
      // EDIT-04
      return {
        ...s,
        segments: s.segments.map((seg) =>
          seg.id === a.segmentId ? { ...seg, text: a.text } : seg,
        ),
      };
    }

    case "split": {
      // editor.jsx lines 121-135 used a hard time-mid-point + half-text
      // split. Quick task 260501-1e4 Task 7 (item line 37 of
      // Things-to-change.txt) extends this with an optional caretIndex so
      // the user's actual click point inside the contentEditable becomes
      // the split point, with the time computed proportionally.
      const idx = s.segments.findIndex((seg) => seg.id === a.segmentId);
      if (idx < 0) return s;
      const seg = s.segments[idx]!;

      // Decide split point in TEXT space first. caretIndex outside the
      // open interval (0, len) falls back to the legacy mid-point so the
      // existing tests stay green.
      const useCaret =
        a.caretIndex !== undefined &&
        a.caretIndex > 0 &&
        a.caretIndex < seg.text.length;
      const splitChar = useCaret
        ? (a.caretIndex as number)
        : Math.floor(seg.text.length / 2);

      // Time space: when caretIndex is given, scale by char ratio so the
      // resulting `mid` lands roughly where the spoken word boundary is.
      // If words[] exists, snap to the nearest word's start time so the
      // playhead aligns with audio boundaries.
      const proportionalMid = useCaret
        ? seg.start + (splitChar / seg.text.length) * (seg.end - seg.start)
        : (seg.start + seg.end) / 2;
      let mid = proportionalMid;
      if (useCaret && seg.words && seg.words.length > 0) {
        let best = seg.words[0]!.s;
        let bestDelta = Math.abs(best - proportionalMid);
        for (const w of seg.words) {
          const d = Math.abs(w.s - proportionalMid);
          if (d < bestDelta) {
            bestDelta = d;
            best = w.s;
          }
        }
        mid = best;
      }

      // Word-half split using the chosen mid time.
      const left: Word[] | undefined = seg.words?.filter((w) => w.s < mid);
      const right: Word[] | undefined = seg.words?.filter((w) => w.s >= mid);

      // Trim trailing whitespace from leftText and leading whitespace from
      // rightText so a click before "mas" produces left="..." right="mas..."
      // rather than left="..." right=" mas..." — fixes item line 37 (the
      // "off-by-one" the user reported).
      const leftText = seg.text.slice(0, splitChar).replace(/\s+$/, "");
      const rightText = seg.text.slice(splitChar).replace(/^\s+/, "");

      const segA: Segment = {
        id: `${seg.id}_a`,
        start: seg.start,
        end: mid,
        speaker: seg.speaker,
        text: leftText || seg.text,
        words: left,
      };
      const segB: Segment = {
        id: `${seg.id}_b`,
        start: mid,
        end: seg.end,
        speaker: seg.speaker,
        text: rightText || seg.text,
        words: right,
      };
      return {
        ...s,
        segments: [
          ...s.segments.slice(0, idx),
          segA,
          segB,
          ...s.segments.slice(idx + 1),
        ],
      };
    }

    case "merge_with_prev": {
      // editor.jsx lines 111-120: i-1 fold logic.
      const idx = s.segments.findIndex((seg) => seg.id === a.segmentId);
      if (idx <= 0) return s; // no previous → no-op
      const prev = s.segments[idx - 1]!;
      const cur = s.segments[idx]!;
      const merged: Segment = {
        id: prev.id,
        start: prev.start,
        end: cur.end,
        speaker: prev.speaker,
        text: `${prev.text} ${cur.text}`.trim(),
        words:
          prev.words && cur.words
            ? [...prev.words, ...cur.words]
            : (prev.words ?? cur.words),
      };
      return {
        ...s,
        segments: [
          ...s.segments.slice(0, idx - 1),
          merged,
          ...s.segments.slice(idx + 1),
        ],
      };
    }

    case "delete": {
      return {
        ...s,
        segments: s.segments.filter((seg) => seg.id !== a.segmentId),
      };
    }

    case "add_speaker": {
      const speaker: Speaker = a.speaker ?? {
        id: nextSpeakerId(s.speakers),
        label: defaultSpeakerLabel(s.speakers),
      };
      return { ...s, speakers: [...s.speakers, speaker] };
    }

    case "restore": {
      return a.state;
    }
  }
}
