/**
 * Tests for lib/webrtc/client.ts — WebRTCEngineClient (Plan 08-07 Task 3).
 *
 * Uses a FakeSignalingChannel and a FakeRTCPeerConnection.
 * RTCPeerConnection is not available in jsdom — these tests mock it.
 *
 * Pattern: The test opens the data channel concurrently with waiting for
 * connect() to resolve, using Promise.all and microtask scheduling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebRTCEngineClient } from "@/lib/webrtc/client";
import type { SignalingChannel } from "@/lib/webrtc/signaling";

// ---------------------------------------------------------------------------
// Fake SignalingChannel
// ---------------------------------------------------------------------------

class FakeSignalingChannel implements SignalingChannel {
  private _handlers: Map<string, Array<(payload: unknown) => void>> = new Map();
  sent: Array<{ event: string; payload: Record<string, unknown> }> = [];
  _status: "subscribing" | "subscribed" | "closed" | "error" = "subscribed";
  closed = false;

  get status() {
    return this._status;
  }

  on(event: string, handler: (payload: unknown) => void): () => void {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event)!.push(handler);
    return () => {
      const arr = this._handlers.get(event) ?? [];
      this._handlers.set(
        event,
        arr.filter((h) => h !== handler),
      );
    };
  }

  async sendBroadcast(
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.sent.push({ event, payload });
  }

  async close(): Promise<void> {
    this.closed = true;
    this._status = "closed";
  }

  deliver(event: string, payload: unknown): void {
    const handlers = this._handlers.get(event) ?? [];
    for (const h of handlers) h(payload);
  }
}

// ---------------------------------------------------------------------------
// Fake RTCDataChannel
// ---------------------------------------------------------------------------

class FakeDataChannel {
  readyState: RTCDataChannelState = "connecting";
  private _onopen: (() => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  sent: unknown[] = [];

  /** If already open, fire immediately when handler is assigned. */
  get onopen() {
    return this._onopen;
  }
  set onopen(fn: (() => void) | null) {
    this._onopen = fn;
    if (fn && this.readyState === "open") {
      // Already open — fire immediately (async via microtask)
      Promise.resolve().then(fn);
    }
  }

  send(data: unknown): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
  addEventListener(): void {}
  removeEventListener(): void {}

  triggerOpen(): void {
    this.readyState = "open";
    this._onopen?.();
  }
}

// ---------------------------------------------------------------------------
// Fake RTCPeerConnection
// ---------------------------------------------------------------------------

class FakeRTCPeerConnection {
  signalingState: RTCSignalingState = "stable";
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;

  onnegotiationneeded: (() => void) | null = null;
  onicecandidate:
    | ((ev: { candidate: RTCIceCandidateInit | null }) => void)
    | null = null;
  onconnectionstatechange: (() => void) | null = null;

  // The data channel is pre-opened so that when connect() sets dc.onopen,
  // the setter fires it immediately via Promise.resolve().then(fn).
  private _dc = new FakeDataChannel();
  readonly iceServersCount: number;

  constructor(config?: RTCConfiguration) {
    this.iceServersCount = config?.iceServers?.length ?? 0;
    // Pre-mark as open so the FakeDataChannel.onopen setter fires immediately
    this._dc.readyState = "open";
  }

  createDataChannel(
    _label: string,
    _opts?: RTCDataChannelInit,
  ): FakeDataChannel {
    return this._dc;
  }

  get fakeDataChannel(): FakeDataChannel {
    return this._dc;
  }

  async setLocalDescription(desc?: RTCSessionDescriptionInit): Promise<void> {
    if (desc?.type === "rollback") {
      this.signalingState = "stable";
      this.localDescription = null;
      return;
    }
    const type: RTCSdpType =
      desc?.type ??
      (this.signalingState === "have-remote-offer" ? "answer" : "offer");
    this.localDescription = { type, sdp: `v=0\r\nfake-${type}-sdp` };
    this.signalingState = type === "offer" ? "have-local-offer" : "stable";
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
    this.signalingState =
      desc.type === "offer" ? "have-remote-offer" : "stable";
  }

  async addIceCandidate(_candidate: RTCIceCandidateInit): Promise<void> {}

  close(): void {
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }
}

// ---------------------------------------------------------------------------
// RTCSessionDescription stub
// ---------------------------------------------------------------------------

class FakeRTCSessionDescription {
  type: RTCSdpType;
  sdp: string;
  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type!;
    this.sdp = init.sdp ?? "";
  }
}

class FakeRTCIceCandidate {
  candidate: string;
  constructor(init: RTCIceCandidateInit) {
    this.candidate = init.candidate ?? "";
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebRTCEngineClient", () => {
  let sigCh: FakeSignalingChannel;
  let fakePc: FakeRTCPeerConnection;

  beforeEach(() => {
    vi.restoreAllMocks();
    sigCh = new FakeSignalingChannel();
    fakePc = new FakeRTCPeerConnection();

    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation((config) => {
        Object.defineProperty(fakePc, "iceServersCount", {
          value: config?.iceServers?.length ?? 0,
          configurable: true,
        });
        return fakePc;
      }),
    );
    vi.stubGlobal("RTCSessionDescription", FakeRTCSessionDescription);
    vi.stubGlobal("RTCIceCandidate", FakeRTCIceCandidate);
  });

  it("connect() fetches TURN credentials from /api/turn-credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        }),
      }),
    );

    const client = new WebRTCEngineClient(sigCh);
    // Schedule data channel open after a microtask
    // fakePc pre-marks DC as open; connect() resolves automatically
    await client.connect();

    expect(fetch).toHaveBeenCalledWith("/api/turn-credentials");
  });

  it("connect() creates a data channel labelled 'transcribe'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const spy = vi.spyOn(fakePc, "createDataChannel");

    const client = new WebRTCEngineClient(sigCh);
    // fakePc pre-marks DC as open; connect() resolves automatically
    const dc = await client.connect();

    expect(spy).toHaveBeenCalledWith("transcribe", { ordered: true });
    expect(dc).toBeTruthy();
  });

  it("handles remote offer during onnegotiationneeded (glare scenario)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const client = new WebRTCEngineClient(sigCh);
    // fakePc pre-marks DC as open; connect() resolves automatically
    await client.connect();

    // Trigger onnegotiationneeded to simulate the polite peer making an offer
    if (fakePc.onnegotiationneeded) {
      await fakePc.onnegotiationneeded();
    }

    // Polite peer should have broadcast a description
    const offersSent = sigCh.sent.filter((m) => m.event === "description");
    expect(offersSent.length).toBeGreaterThan(0);

    // Now deliver a remote offer from the engine (glare)
    sigCh.deliver("description", {
      type: "description",
      sdp: { type: "offer", sdp: "v=0\r\nremote-offer" },
    });
    // Flush async handler microtasks (the description handler is async)
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Polite peer should answer the remote offer
    const answers = sigCh.sent.filter(
      (m) =>
        m.event === "description" &&
        (m.payload as { sdp?: { type?: string } }).sdp?.type === "answer",
    );
    expect(answers.length).toBeGreaterThan(0);
  });

  it("close() releases PC, data channel, and signaling channel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const closeSpy = vi.spyOn(fakePc, "close");

    const client = new WebRTCEngineClient(sigCh);
    // fakePc pre-marks DC as open; connect() resolves automatically
    await client.connect();
    await client.close();

    expect(closeSpy).toHaveBeenCalled();
    expect(sigCh.closed).toBe(true);
  });

  it("CR-06: onConnectionStateChange handler fires for state changes after connect()", async () => {
    // Verifies that pc.onconnectionstatechange is set exactly once and that
    // handlers registered both before AND after connect() receive state changes.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const client = new WebRTCEngineClient(sigCh);

    const statesBefore: string[] = [];
    const statesAfter: string[] = [];

    // Register a handler BEFORE connect()
    client.onConnectionStateChange((s) => statesBefore.push(s));

    await client.connect();

    // Register a handler AFTER connect()
    client.onConnectionStateChange((s) => statesAfter.push(s));

    // Simulate a state change by calling the installed onconnectionstatechange
    fakePc.connectionState = "connected" as RTCPeerConnectionState;
    fakePc.onconnectionstatechange?.();

    fakePc.connectionState = "failed" as RTCPeerConnectionState;
    fakePc.onconnectionstatechange?.();

    // Both handlers must have received both state events
    expect(statesBefore).toContain("connected");
    expect(statesBefore).toContain("failed");
    expect(statesAfter).toContain("connected");
    expect(statesAfter).toContain("failed");
  });
});
