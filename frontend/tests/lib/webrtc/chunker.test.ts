/**
 * Tests for lib/webrtc/chunker.ts — sendAudioChunked (Plan 08-07 Task 3).
 *
 * Uses a fake RTCDataChannel that records all .send() calls and supports
 * manual triggering of the `bufferedamountlow` event.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sendAudioChunked,
  CHUNK_SIZE,
  HIGH_WATER_MARK,
  LOW_WATER_MARK,
} from "@/lib/webrtc/chunker";

// ---------------------------------------------------------------------------
// Fake RTCDataChannel
// ---------------------------------------------------------------------------

type EventName = string;
type EventHandler = (ev?: Event) => void;

class FakeDataChannel {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  readyState: RTCDataChannelState = "open";
  private _listeners: Map<EventName, Set<EventHandler>> = new Map();

  sent: (ArrayBuffer | string)[] = [];

  send(data: ArrayBuffer | string): void {
    this.sent.push(data);
  }

  addEventListener(event: EventName, handler: EventHandler): void {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(handler);
  }

  removeEventListener(event: EventName, handler: EventHandler): void {
    this._listeners.get(event)?.delete(handler);
  }

  /** Test helper — fire the bufferedamountlow event. */
  triggerLow(): void {
    const handlers = this._listeners.get("bufferedamountlow");
    if (handlers) {
      for (const h of handlers) h();
    }
  }

  /** Test helper — simulate channel closing mid-send. */
  close(): void {
    this.readyState = "closed";
  }

  // Satisfy RTCDataChannel type shape (unused fields)
  label = "transcribe";
  ordered = true;
  protocol = "";
  id: number | null = null;
  maxPacketLifeTime: number | null = null;
  maxRetransmits: number | null = null;
  negotiated = false;
  onbufferedamountlow: null = null;
  onclose: null = null;
  onclosing: null = null;
  onerror: null = null;
  onmessage: null = null;
  onopen: null = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeFile(size: number): File {
  return new File([new ArrayBuffer(size)], "test.webm", {
    type: "audio/webm",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sendAudioChunked", () => {
  it("chunks a file at CHUNK_SIZE boundaries", async () => {
    const ch = new FakeDataChannel();
    const fileSize = CHUNK_SIZE * 3; // exactly 3 chunks
    const file = makeFakeFile(fileSize);

    await sendAudioChunked(ch as unknown as RTCDataChannel, file, 0, () => {});

    // 3 binary chunks + 1 JSON audio_eof
    expect(ch.sent).toHaveLength(4);

    // Each binary chunk must be an ArrayBuffer and ≤ CHUNK_SIZE
    for (const frame of ch.sent.slice(0, 3)) {
      expect(frame).toBeInstanceOf(ArrayBuffer);
      expect((frame as ArrayBuffer).byteLength).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it("sends audio_eof as the last message", async () => {
    const ch = new FakeDataChannel();
    const file = makeFakeFile(CHUNK_SIZE);

    await sendAudioChunked(ch as unknown as RTCDataChannel, file, 0, () => {});

    const last = ch.sent[ch.sent.length - 1];
    expect(typeof last).toBe("string");
    const parsed = JSON.parse(last as string);
    expect(parsed.type).toBe("audio_eof");
    expect(parsed.total_bytes).toBe(CHUNK_SIZE);
  });

  it("pauses when bufferedAmount exceeds HIGH_WATER_MARK", async () => {
    const ch = new FakeDataChannel();
    // Set bufferedAmount above the high-water mark so the chunker will wait.
    ch.bufferedAmount = HIGH_WATER_MARK + 1;

    const file = makeFakeFile(CHUNK_SIZE);
    let resolved = false;

    const promise = sendAudioChunked(
      ch as unknown as RTCDataChannel,
      file,
      0,
      () => {},
    ).then(() => {
      resolved = true;
    });

    // Should not have sent anything yet (waiting for low event)
    await Promise.resolve();
    expect(ch.sent).toHaveLength(0);

    // Fire the bufferedamountlow event to unblock
    ch.bufferedAmount = LOW_WATER_MARK - 1;
    ch.triggerLow();

    await promise;
    expect(resolved).toBe(true);
    expect(ch.sent.length).toBeGreaterThan(0);
  });

  it("resumes from fromOffset (partial file resume)", async () => {
    const ch = new FakeDataChannel();
    const fileSize = CHUNK_SIZE * 4;
    const file = makeFakeFile(fileSize);
    const fromOffset = CHUNK_SIZE * 2; // resume halfway

    const progressCalls: number[] = [];
    await sendAudioChunked(
      ch as unknown as RTCDataChannel,
      file,
      fromOffset,
      (sent) => progressCalls.push(sent),
    );

    // Only 2 binary chunks (chunks 3 and 4) + 1 audio_eof
    expect(ch.sent).toHaveLength(3);
    // Last progress call should have bytesSent near the total
    expect(progressCalls[progressCalls.length - 1]).toBeLessThanOrEqual(
      fileSize,
    );
  });

  it("throws if channel closes mid-send", async () => {
    const ch = new FakeDataChannel();

    // Close the channel immediately before the first chunk is sent
    const origSend = ch.send.bind(ch);
    ch.send = (data: ArrayBuffer | string) => {
      origSend(data);
      ch.close(); // close after first send
    };

    const file = makeFakeFile(CHUNK_SIZE * 3);

    await expect(
      sendAudioChunked(ch as unknown as RTCDataChannel, file, 0, () => {}),
    ).rejects.toThrow("channel closed mid-transfer");
  });

  it("sets bufferedAmountLowThreshold to LOW_WATER_MARK", async () => {
    const ch = new FakeDataChannel();
    const file = makeFakeFile(CHUNK_SIZE);

    await sendAudioChunked(ch as unknown as RTCDataChannel, file, 0, () => {});

    expect(ch.bufferedAmountLowThreshold).toBe(LOW_WATER_MARK);
  });

  it("calls onProgress after each chunk with correct byte counts", async () => {
    const ch = new FakeDataChannel();
    const fileSize = CHUNK_SIZE * 2;
    const file = makeFakeFile(fileSize);

    const progressCalls: Array<{ sent: number; total: number }> = [];
    await sendAudioChunked(
      ch as unknown as RTCDataChannel,
      file,
      0,
      (sent, total) => progressCalls.push({ sent, total }),
    );

    expect(progressCalls.length).toBe(2);
    expect(progressCalls[0].total).toBe(fileSize);
    expect(progressCalls[1].sent).toBe(fileSize);
  });
});
