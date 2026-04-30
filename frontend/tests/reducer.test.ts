import { describe, it, expect } from "vitest";
import { editorReducer, type EditorState } from "@/lib/editor/reducer";
import { SAMPLE_PAYLOAD } from "@/lib/mock/data";

function freshState(): EditorState {
  // Deep clone so tests don't share mutable refs.
  return JSON.parse(JSON.stringify(SAMPLE_PAYLOAD)) as EditorState;
}

describe("editorReducer", () => {
  it("rename_speaker updates only the matching speaker label (EDIT-01)", () => {
    const s = freshState();
    const next = editorReducer(s, {
      type: "rename_speaker",
      speakerId: "S0",
      label: "Maya O.",
    });
    expect(next.speakers.find((sp) => sp.id === "S0")?.label).toBe("Maya O.");
    expect(next.speakers.find((sp) => sp.id === "S1")?.label).toBe(
      s.speakers.find((sp) => sp.id === "S1")?.label,
    );
    // segments[] reference by id — array length unchanged
    expect(next.segments.length).toBe(s.segments.length);
  });

  it("rename_speaker with empty label is a no-op", () => {
    const s = freshState();
    const next = editorReducer(s, { type: "rename_speaker", speakerId: "S0", label: "  " });
    expect(next).toBe(s); // strict equality — same object reference
  });

  it("reassign_segment moves one segment without changing speakers[] (EDIT-02)", () => {
    const s = freshState();
    const segId = s.segments[0]!.id;
    const next = editorReducer(s, {
      type: "reassign_segment",
      segmentId: segId,
      toSpeakerId: "S2",
    });
    expect(next.segments[0]!.speaker).toBe("S2");
    expect(next.speakers).toEqual(s.speakers);
  });

  it("reassign_segment with bulk:true reassigns ALL segs of source AND removes source speaker (EDIT-03)", () => {
    const s = freshState();
    const sourceSeg = s.segments.find((seg) => seg.speaker === "S0")!;
    const before = s.segments.filter((seg) => seg.speaker === "S0").length;
    expect(before).toBeGreaterThan(0);
    const next = editorReducer(s, {
      type: "reassign_segment",
      segmentId: sourceSeg.id,
      toSpeakerId: "S1",
      bulk: true,
    });
    // No segs left referencing S0
    expect(next.segments.filter((seg) => seg.speaker === "S0").length).toBe(0);
    // S0 removed from speakers[]
    expect(next.speakers.find((sp) => sp.id === "S0")).toBeUndefined();
    // Other speakers preserved
    expect(next.speakers.find((sp) => sp.id === "S1")).toBeDefined();
  });

  it("edit_text updates only one segment (EDIT-04)", () => {
    const s = freshState();
    const segId = s.segments[2]!.id;
    const next = editorReducer(s, {
      type: "edit_text",
      segmentId: segId,
      text: "Brand new text.",
    });
    expect(next.segments.find((seg) => seg.id === segId)?.text).toBe("Brand new text.");
    expect(next.segments[0]!.text).toBe(s.segments[0]!.text);
  });

  it("split creates two segments at the mid-point", () => {
    const s = freshState();
    const seg = s.segments[0]!;
    const next = editorReducer(s, { type: "split", segmentId: seg.id });
    expect(next.segments.length).toBe(s.segments.length + 1);
    const splitA = next.segments.find((x) => x.id === `${seg.id}_a`)!;
    const splitB = next.segments.find((x) => x.id === `${seg.id}_b`)!;
    const mid = (seg.start + seg.end) / 2;
    expect(splitA.start).toBe(seg.start);
    expect(splitA.end).toBe(mid);
    expect(splitB.start).toBe(mid);
    expect(splitB.end).toBe(seg.end);
    expect(splitA.speaker).toBe(seg.speaker);
    expect(splitB.speaker).toBe(seg.speaker);
  });

  it("merge_with_prev folds current into previous keeping earliest start + latest end", () => {
    const s = freshState();
    const segA = s.segments[0]!;
    const segB = s.segments[1]!;
    const next = editorReducer(s, { type: "merge_with_prev", segmentId: segB.id });
    expect(next.segments.length).toBe(s.segments.length - 1);
    const merged = next.segments[0]!;
    expect(merged.start).toBe(segA.start);
    expect(merged.end).toBe(segB.end);
    expect(merged.text).toContain(segA.text.split(" ")[0]!);
    expect(merged.text).toContain(segB.text.split(" ")[0]!);
  });

  it("merge_with_prev on segs[0] is a no-op", () => {
    const s = freshState();
    const next = editorReducer(s, { type: "merge_with_prev", segmentId: s.segments[0]!.id });
    expect(next).toBe(s);
  });

  it("delete removes the segment", () => {
    const s = freshState();
    const segId = s.segments[5]!.id;
    const next = editorReducer(s, { type: "delete", segmentId: segId });
    expect(next.segments.length).toBe(s.segments.length - 1);
    expect(next.segments.find((seg) => seg.id === segId)).toBeUndefined();
  });

  it("add_speaker appends with auto-generated id + label", () => {
    const s = freshState();
    const next = editorReducer(s, { type: "add_speaker" });
    expect(next.speakers.length).toBe(s.speakers.length + 1);
    const added = next.speakers[next.speakers.length - 1]!;
    expect(added.id).toMatch(/^S\d+$/);
    expect(added.label).toMatch(/^Speaker \d+$/);
  });

  it("restore replaces the entire state (D-30)", () => {
    const s = freshState();
    const replacement: EditorState = {
      version: 1,
      language: "pt",
      duration_sec: 99,
      speakers: [{ id: "S0", label: "Other" }],
      segments: [],
    };
    const next = editorReducer(s, { type: "restore", state: replacement });
    expect(next).toEqual(replacement);
  });
});
