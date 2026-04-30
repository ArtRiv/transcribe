import { describe, it, expect } from "vitest";
import {
  fmtTime, fmtSrtTime, fmtVttTime,
  renderTxt, renderSrt, renderVtt, renderMd, renderJson,
} from "@/lib/editor/exporters";
import type { EditorState } from "@/lib/editor/reducer";
import { SAMPLE_PAYLOAD } from "@/lib/mock/data";

const tinyFixture: EditorState = {
  version: 1,
  language: "en",
  duration_sec: 14.2,
  speakers: [
    { id: "S0", label: "Maya Okafor" },
    { id: "S1", label: "Jonas Rivera" },
  ],
  segments: [
    { id: "seg_0001", start: 0, end: 7.4, speaker: "S0", text: "Hello." },
    { id: "seg_0002", start: 7.6, end: 14.2, speaker: "S1", text: "World." },
  ],
};

describe("fmtTime (mm:ss)", () => {
  it("emits 00:00 for zero", () => { expect(fmtTime(0)).toBe("00:00"); });
  it("zero-pads sub-minute seconds", () => { expect(fmtTime(7.4)).toBe("00:07"); });
  it("rounds fractional seconds down", () => { expect(fmtTime(7.9)).toBe("00:07"); });
  it("emits 02:14 for 134.5s", () => { expect(fmtTime(134.5)).toBe("02:14"); });
  it("emits 60:00 for 1h (mm:ss truncates hours)", () => { expect(fmtTime(3600)).toBe("60:00"); });
});

describe("fmtSrtTime (HH:MM:SS,mmm)", () => {
  it("emits 00:00:00,000 for zero", () => { expect(fmtSrtTime(0)).toBe("00:00:00,000"); });
  it("emits 00:00:07,400 for 7.4s", () => { expect(fmtSrtTime(7.4)).toBe("00:00:07,400"); });
  it("emits 01:00:00,000 for 1h", () => { expect(fmtSrtTime(3600)).toBe("01:00:00,000"); });
  it("emits 01:01:40,123 for 3700.123s", () => { expect(fmtSrtTime(3700.123)).toBe("01:01:40,123"); });
  it("uses comma decimal not period (SRT spec)", () => { expect(fmtSrtTime(7.4)).toContain(","); expect(fmtSrtTime(7.4)).not.toContain("."); });
});

describe("fmtVttTime (HH:MM:SS.mmm)", () => {
  it("uses period decimal not comma", () => { expect(fmtVttTime(7.4)).toBe("00:00:07.400"); expect(fmtVttTime(7.4)).toContain("."); expect(fmtVttTime(7.4)).not.toContain(","); });
  it("matches SRT format with period substituted", () => { expect(fmtVttTime(3700.123)).toBe("01:01:40.123"); });
});

describe("renderTxt", () => {
  it("emits speakers + timestamps when both enabled (RESEARCH lines 1242-1245)", () => {
    expect(renderTxt(tinyFixture, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" })).toBe(
      "[00:00] Maya: Hello.\n\n[00:07] Jonas: World.",
    );
  });
  it("omits both when disabled", () => {
    expect(renderTxt(tinyFixture, { includeSpeakers: false, includeTimestamps: false, speakerNameFmt: "first" })).toBe(
      "Hello.\n\nWorld.",
    );
  });
  it("emits timestamps without speakers", () => {
    expect(renderTxt(tinyFixture, { includeSpeakers: false, includeTimestamps: true, speakerNameFmt: "first" })).toBe(
      "[00:00] Hello.\n\n[00:07] World.",
    );
  });
  it("speakerNameFmt 'initials' joins single-letter parts", () => {
    const out = renderTxt(tinyFixture, { includeSpeakers: true, includeTimestamps: false, speakerNameFmt: "initials" });
    expect(out).toContain("M.O:");
    expect(out).toContain("J.R:");
  });
  it("speakerNameFmt 'full' uses entire label", () => {
    const out = renderTxt(tinyFixture, { includeSpeakers: true, includeTimestamps: false, speakerNameFmt: "full" });
    expect(out).toContain("Maya Okafor:");
  });
  it("returns empty string for empty segments", () => {
    const empty: EditorState = { ...tinyFixture, segments: [] };
    expect(renderTxt(empty, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" })).toBe("");
  });
});

describe("renderSrt", () => {
  it("emits 1-indexed cues with HH:MM:SS,mmm + speaker prefix", () => {
    const out = renderSrt(tinyFixture, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    expect(out).toMatch(/^1\n00:00:00,000 --> 00:00:07,400\nMaya: Hello\.\n\n2\n00:00:07,600 --> 00:00:14,200\nJonas: World\.\n\n$/);
  });
  it("uses comma decimal in timestamps (SRT spec)", () => {
    const out = renderSrt(tinyFixture, { includeSpeakers: false, includeTimestamps: true, speakerNameFmt: "first" });
    expect(out).toContain("00:00:00,000");
    expect(out).not.toContain("00:00:00.000");
  });
  it("formats hour-spanning timestamps correctly", () => {
    const longFixture: EditorState = { ...tinyFixture, segments: [
      { id: "seg_0001", start: 3700.123, end: 3705.456, speaker: "S0", text: "Long." },
    ]};
    const out = renderSrt(longFixture, { includeSpeakers: false, includeTimestamps: true, speakerNameFmt: "first" });
    expect(out).toContain("01:01:40,123 --> 01:01:45,456");
  });
});

describe("renderVtt", () => {
  it("starts with WEBVTT header", () => {
    const out = renderVtt(tinyFixture, { includeSpeakers: false, includeTimestamps: true, speakerNameFmt: "first" });
    expect(out.startsWith("WEBVTT\n\n")).toBe(true);
  });
  it("uses period decimal in timestamps", () => {
    const out = renderVtt(tinyFixture, { includeSpeakers: false, includeTimestamps: true, speakerNameFmt: "first" });
    expect(out).toContain("00:00:07.400");
    expect(out).not.toContain("00:00:07,400");
  });
  it("emits <v Name> cue identifier when speakers enabled", () => {
    const out = renderVtt(tinyFixture, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    expect(out).toContain("<v Maya>");
    expect(out).toContain("<v Jonas>");
  });
});

describe("renderMd", () => {
  it("emits italic subtitle", () => {
    const out = renderMd(tinyFixture, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    expect(out).toMatch(/_2 speakers/);
  });
  it("renders timestamps in backticks", () => {
    const out = renderMd(tinyFixture, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    expect(out).toContain("`00:00`");
  });
  it("renders speaker names in bold", () => {
    const out = renderMd(tinyFixture, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    expect(out).toContain("**Maya**");
  });
  it("omits speakers when disabled", () => {
    const out = renderMd(tinyFixture, { includeSpeakers: false, includeTimestamps: false, speakerNameFmt: "first" });
    expect(out).not.toContain("**Maya**");
    expect(out).not.toContain("**Jonas**");
  });
});

describe("renderJson (round-trippable)", () => {
  it("emits pretty-printed JSON parseable as TranscriptPayload (EXPORT-04 round-trip)", () => {
    const json = renderJson(tinyFixture);
    const parsed = JSON.parse(json) as EditorState;
    expect(parsed).toEqual(tinyFixture);
  });
  it("uses 2-space indentation", () => {
    const json = renderJson(tinyFixture);
    // First nested line should be indented by exactly 2 spaces.
    const lines = json.split("\n");
    const firstNested = lines.find((line) => line.startsWith("  ") && !line.startsWith("    "));
    expect(firstNested).toBeDefined();
  });
  it("round-trips with empty segments", () => {
    const empty: EditorState = { ...tinyFixture, segments: [] };
    const parsed = JSON.parse(renderJson(empty)) as EditorState;
    expect(parsed.segments).toEqual([]);
  });
});

describe("EXPORT-07 — renderers consume EditorState in memory without mutating it", () => {
  it("does not mutate the input state", () => {
    const snapshot = JSON.parse(JSON.stringify(tinyFixture));
    renderTxt(tinyFixture, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    renderSrt(tinyFixture, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    renderVtt(tinyFixture, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    renderMd(tinyFixture, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    renderJson(tinyFixture);
    expect(tinyFixture).toEqual(snapshot);
  });
});

describe("Unicode + edge cases", () => {
  it("preserves em-dashes and accents in TXT", () => {
    const f: EditorState = { ...tinyFixture, segments: [
      { id: "seg_0001", start: 0, end: 1, speaker: "S0", text: "Olá — está você aí?" },
    ]};
    const out = renderTxt(f, { includeSpeakers: false, includeTimestamps: false, speakerNameFmt: "first" });
    expect(out).toBe("Olá — está você aí?");
  });
  it("preserves CJK characters in JSON", () => {
    const f: EditorState = { ...tinyFixture, segments: [
      { id: "seg_0001", start: 0, end: 1, speaker: "S0", text: "こんにちは" },
    ]};
    const parsed = JSON.parse(renderJson(f)) as EditorState;
    expect(parsed.segments[0]!.text).toBe("こんにちは");
  });
});

describe("Integration with SAMPLE_PAYLOAD (Plan 03-01 fixture)", () => {
  it("renderTxt produces non-empty output for the 18-segment sample", () => {
    const out = renderTxt(SAMPLE_PAYLOAD, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    expect(out.length).toBeGreaterThan(100);
    expect(out.split("\n\n").length).toBe(SAMPLE_PAYLOAD.segments.length);
  });
  it("renderSrt emits cue count == segment count", () => {
    const out = renderSrt(SAMPLE_PAYLOAD, { includeSpeakers: true, includeTimestamps: true, speakerNameFmt: "first" });
    const cueLines = out.split("\n").filter((line) => /^\d+$/.test(line));
    expect(cueLines.length).toBe(SAMPLE_PAYLOAD.segments.length);
  });
});
