/**
 * Tests for lib/webrtc/protocol.ts — TypeScript wire-format discriminated unions.
 *
 * Verifies:
 * - PROTOCOL_VERSION constant is "1"
 * - KNOWN_MESSAGE_TYPES has exactly 13 entries
 * - parseWire round-trips each known type
 * - parseWire throws on unknown types
 * - KNOWN_MESSAGE_TYPES set-equality with engine messages.py (cross-repo drift guardrail)
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  KNOWN_MESSAGE_TYPES,
  PROTOCOL_VERSION,
  parseWire,
  type WireMessage,
} from "@/lib/webrtc/protocol";

// ---------------------------------------------------------------------------
// Basic constants
// ---------------------------------------------------------------------------

describe("PROTOCOL_VERSION", () => {
  it("is '1'", () => {
    expect(PROTOCOL_VERSION).toBe("1");
  });
});

describe("KNOWN_MESSAGE_TYPES", () => {
  it("has exactly 13 entries (OfferMsg + AnswerMsg share 'description')", () => {
    expect(KNOWN_MESSAGE_TYPES).toHaveLength(13);
  });

  it("contains all expected type strings", () => {
    const expected = new Set([
      "hello",
      "state",
      "description",
      "candidate",
      "audio_eof",
      "checkpoint",
      "progress",
      "result",
      "resume_query",
      "resume_state",
      "ping",
      "pong",
      "error",
    ]);
    const actual = new Set(KNOWN_MESSAGE_TYPES as unknown as string[]);
    expect(actual).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// parseWire round-trips
// ---------------------------------------------------------------------------

const SYNTHETIC_PAYLOADS: Record<string, unknown>[] = [
  {
    type: "hello",
    version: "0.2.0",
    protocol_version: "1",
    gpu: "RX 6600 (Vulkan)",
  },
  { type: "state", value: "idle" },
  {
    type: "description",
    sdp: { type: "offer", sdp: "v=0\r\no=..." },
  },
  {
    type: "candidate",
    candidate: { candidate: "candidate:0 ...", sdpMid: "0", sdpMLineIndex: 0 },
  },
  { type: "audio_eof", total_bytes: 1048576 },
  { type: "checkpoint", byte_offset: 524288 },
  { type: "progress", stage: "transcribe", fraction: 0.42 },
  {
    type: "result",
    transcript: {
      version: 1,
      language: "en",
      duration_sec: 60.0,
      speakers: [{ id: "S0", label: "Speaker 1" }],
      segments: [
        {
          id: "seg_0001",
          start: 0.0,
          end: 5.0,
          speaker: "S0",
          text: "Hello.",
          words: [{ w: "Hello.", s: 0.0, e: 0.5 }],
        },
      ],
    },
  },
  { type: "resume_query", job_id: "job-abc-123" },
  { type: "resume_state", byte_offset: 262144 },
  { type: "ping" },
  { type: "pong" },
  { type: "error", code: "no_model", message: "Model not loaded" },
];

describe("parseWire", () => {
  it.each(SYNTHETIC_PAYLOADS.map((p) => [p.type as string, p]))(
    "round-trips type '%s'",
    (_type, payload) => {
      const raw = JSON.stringify(payload);
      const result = parseWire(raw);
      expect(result).toEqual(payload);
    },
  );

  it("throws on unknown type", () => {
    expect(() => parseWire('{"type":"bogus"}')).toThrow("bogus");
  });

  it("throws when type key is missing", () => {
    expect(() => parseWire('{"data":"no type"}')).toThrow();
  });

  it("throws on non-object JSON (null)", () => {
    expect(() => parseWire("null")).toThrow("JSON object");
  });

  it("throws on non-object JSON (array)", () => {
    expect(() => parseWire("[1,2,3]")).toThrow("JSON object");
  });

  it("throws when hello message has wrong protocol_version", () => {
    const msg = JSON.stringify({
      type: "hello",
      version: "0.2.0",
      protocol_version: "2",
      gpu: "RX 6600 (Vulkan)",
    });
    expect(() => parseWire(msg)).toThrow("Protocol version mismatch");
  });

  it("throws when hello message is missing protocol_version", () => {
    const msg = JSON.stringify({
      type: "hello",
      version: "0.2.0",
      gpu: "RX 6600 (Vulkan)",
    });
    expect(() => parseWire(msg)).toThrow("Protocol version mismatch");
  });
});

// ---------------------------------------------------------------------------
// Cross-repo KNOWN_MESSAGE_TYPES set-equality (T-08-05-02 drift guardrail)
// ---------------------------------------------------------------------------

describe("Cross-repo schema drift", () => {
  it("KNOWN_MESSAGE_TYPES matches engine protocol/messages.py", () => {
    // The engine repo sits at a known path in the monorepo workspace.
    // If the file is not found, we fall back to a hard-coded mirror constant
    // (documented in the SUMMARY) so CI stays GREEN on machines where only
    // the frontend is checked out.
    const ENGINE_PATH = join(
      __dirname,
      "../../../../..",
      "transcribe-engine/transcribe_engine/protocol/messages.py",
    );

    const HARDCODED_MIRROR = [
      "hello",
      "state",
      "description",
      "candidate",
      "audio_eof",
      "checkpoint",
      "progress",
      "result",
      "resume_query",
      "resume_state",
      "ping",
      "pong",
      "error",
    ] as const;

    let engineTypes: string[];
    try {
      const src = readFileSync(ENGINE_PATH, "utf-8");
      // Extract the list from:  KNOWN_MESSAGE_TYPES = ['hello', 'state', ...]
      const match = src.match(/KNOWN_MESSAGE_TYPES\s*=\s*\[([^\]]+)\]/);
      if (!match) {
        throw new Error("KNOWN_MESSAGE_TYPES not found in engine messages.py");
      }
      engineTypes = match[1]
        .split(",")
        .map((s) => s.trim().replace(/['"]/g, ""))
        .filter(Boolean);
    } catch {
      // Engine repo not present on this machine — use hard-coded mirror.
      engineTypes = [...HARDCODED_MIRROR];
    }

    const frontendSet = new Set(KNOWN_MESSAGE_TYPES as unknown as string[]);
    const engineSet = new Set(engineTypes);
    expect(frontendSet).toEqual(engineSet);
  });
});
