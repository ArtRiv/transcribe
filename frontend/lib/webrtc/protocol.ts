/**
 * Wire-format discriminated unions for the WebRTC data channel (Plan 08-05).
 *
 * This file is the TypeScript mirror of:
 *   transcribe-engine/transcribe_engine/protocol/messages.py
 *
 * 14 message interfaces, 13 wire-type strings — OfferMsg + AnswerMsg share
 * `type: 'description'` and are distinguished by `sdp.type`.
 *
 * Plans 06 and 07 import from here:
 *   Plan 06 (signaling client):  HelloMsg, StateMsg
 *   Plan 07 (WebRTC handler):    OfferMsg, AnswerMsg, CandidateMsg, AudioEofMsg,
 *                                CheckpointMsg, ProgressMsg, ResultMsg
 *
 * The engine Python mirror is transcribe_engine/protocol/messages.py — both
 * files export an identical KNOWN_MESSAGE_TYPES array. A cross-repo
 * set-equality test in tests/lib/webrtc/protocol.test.ts catches drift.
 *
 * TranscriptPayload is imported and re-exported from @/lib/mock/data (the
 * canonical v1 schema source of truth — D-22). Never duplicate it here.
 */

import type {
  TranscriptPayload,
  Speaker,
  Segment,
  Word,
} from "@/lib/mock/data";
export type { TranscriptPayload, Speaker, Segment, Word };

// Wire protocol version — bumped when the message shape changes in a
// backwards-incompatible way. Both engine and frontend must agree on this.
export const PROTOCOL_VERSION = "1";

// ---------------------------------------------------------------------------
// Nested payload types
// ---------------------------------------------------------------------------

export interface SdpDescription {
  type: "offer" | "answer";
  sdp: string;
}

export interface IceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}

// ---------------------------------------------------------------------------
// Message interfaces (14 interfaces, 13 wire-type strings)
// ---------------------------------------------------------------------------

export interface HelloMsg {
  type: "hello";
  version: string; // engine semver e.g. "0.2.0"
  protocol_version: string; // wire protocol version e.g. "1"
  gpu: string; // GPU label e.g. "RX 6600 (Vulkan)"
}

export interface StateMsg {
  type: "state";
  value: "idle" | "transcribing" | "loading_model" | "gpu_warming" | "offline";
}

/** SDP offer — disambiguated from AnswerMsg by sdp.type === 'offer'. */
export interface OfferMsg {
  type: "description";
  sdp: SdpDescription & { type: "offer" };
}

/** SDP answer — disambiguated from OfferMsg by sdp.type === 'answer'. */
export interface AnswerMsg {
  type: "description";
  sdp: SdpDescription & { type: "answer" };
}

export interface CandidateMsg {
  type: "candidate";
  candidate: IceCandidate;
}

export interface AudioEofMsg {
  type: "audio_eof";
  total_bytes: number;
}

export interface CheckpointMsg {
  type: "checkpoint";
  byte_offset: number;
}

export interface ProgressMsg {
  type: "progress";
  stage: "normalize" | "transcribe" | "diarize" | "merge";
  fraction: number;
}

export interface ResultMsg {
  type: "result";
  transcript: TranscriptPayload;
}

/**
 * Sent by the frontend before binary chunks begin.
 *
 * CR-02: binds file identity (sha256_hex) to job_id so the engine can
 * detect cross-file splicing on resume.
 */
export interface JobInitMsg {
  type: "job_init";
  job_id: string;
  sha256_hex: string; // lowercase hex SHA-256 of the full source file
  total_bytes: number; // expected file size in bytes (informational)
}

export interface ResumeQueryMsg {
  type: "resume_query";
  job_id: string;
  sha256_hex: string; // CR-02: must match the sidecar on the engine side
}

export interface ResumeStateMsg {
  type: "resume_state";
  byte_offset: number;
}

export interface PingMsg {
  type: "ping";
}

export interface PongMsg {
  type: "pong";
}

export interface ErrorMsg {
  type: "error";
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Discriminating union
// ---------------------------------------------------------------------------

export type WireMessage =
  | HelloMsg
  | StateMsg
  | OfferMsg // AnswerMsg is structurally a union member too; TS uses sdp.type to narrow
  | AnswerMsg
  | CandidateMsg
  | JobInitMsg
  | AudioEofMsg
  | CheckpointMsg
  | ProgressMsg
  | ResultMsg
  | ResumeQueryMsg
  | ResumeStateMsg
  | PingMsg
  | PongMsg
  | ErrorMsg;

// 14 distinct `type` discriminator strings (was 13 before CR-02 added job_init).
// OfferMsg and AnswerMsg share `type: 'description'` and are disambiguated by
// sdp.type ('offer' vs 'answer').  The 15 message interfaces collapse to 14
// wire-format type strings — the cross-repo set-equality test pins this.
export const KNOWN_MESSAGE_TYPES = [
  "hello",
  "state",
  "description",
  "candidate",
  "job_init",
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

export type KnownMessageType = (typeof KNOWN_MESSAGE_TYPES)[number];

// ---------------------------------------------------------------------------
// parseWire
// ---------------------------------------------------------------------------

/**
 * Decode a JSON wire message and validate its `type` discriminator.
 *
 * Throws with the offending type value in the message on unknown types, or
 * when a 'hello' message carries a protocol_version != PROTOCOL_VERSION.
 * Plans 06 and 07 wrap this with try/catch + ErrorMsg emission.
 */
export function parseWire(raw: string): WireMessage {
  const data = JSON.parse(raw);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Wire message must be a JSON object, got ${typeof data}`);
  }
  const obj = data as Record<string, unknown>;
  const msgType = obj["type"];
  if (
    typeof msgType !== "string" ||
    !(KNOWN_MESSAGE_TYPES as readonly string[]).includes(msgType)
  ) {
    throw new Error(
      `Unknown wire message type ${JSON.stringify(msgType)}. Known types: ${KNOWN_MESSAGE_TYPES.join(", ")}`,
    );
  }
  if (msgType === "hello") {
    const pv = obj["protocol_version"];
    if (pv !== PROTOCOL_VERSION) {
      throw new Error(
        `Protocol version mismatch: peer=${JSON.stringify(pv)} local=${JSON.stringify(PROTOCOL_VERSION)}`,
      );
    }
  }
  return obj as unknown as WireMessage;
}
