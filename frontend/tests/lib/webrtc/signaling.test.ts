/**
 * Tests for lib/webrtc/signaling.ts — Realtime broadcast channel wrapper.
 *
 * Uses vi.fn() + fake Supabase channel to avoid real WebSocket connections.
 * Verifies: outbound buffering, self-filter, parse error handling, status
 * progression, and close/unsubscribe.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSignalingChannel } from "@/lib/webrtc/signaling";

// ---------------------------------------------------------------------------
// Fake Supabase channel + client
// ---------------------------------------------------------------------------

type BroadcastHandler = (payload: { payload: unknown }) => void;

class FakeChannel {
  _handlers: Map<string, BroadcastHandler[]> = new Map();
  _subscribeCallback: ((status: string) => void) | null = null;
  sentBroadcasts: { event: string; payload: unknown }[] = [];
  _subscribeStatus = "SUBSCRIBED"; // default: immediately subscribed

  on(_type: string, opts: { event: string }, handler: BroadcastHandler) {
    const existing = this._handlers.get(opts.event) ?? [];
    this._handlers.set(opts.event, [...existing, handler]);
    return this;
  }

  subscribe(callback?: (status: string) => void) {
    this._subscribeCallback = callback ?? null;
    // Call asynchronously so we can test buffering
    queueMicrotask(() => {
      callback?.(this._subscribeStatus);
    });
    return this;
  }

  async send(msg: { type: string; event: string; payload: unknown }) {
    this.sentBroadcasts.push({ event: msg.event, payload: msg.payload });
  }

  // Inject an inbound broadcast from the server
  inject(event: string, payload: unknown) {
    const handlers = this._handlers.get(event) ?? [];
    for (const h of handlers) {
      h({ payload });
    }
  }

  // Also support wildcard '*'
  injectAny(event: string, payload: unknown) {
    // fire '*' handlers
    const wildHandlers = this._handlers.get("*") ?? [];
    for (const h of wildHandlers) {
      h({ payload: { ...((payload as object) ?? {}), event } });
    }
    this.inject(event, payload);
  }
}

class FakeSupabase {
  channels: FakeChannel[] = [];
  removedChannels: FakeChannel[] = [];

  channel(_name: string, _opts?: unknown): FakeChannel {
    const ch = new FakeChannel();
    this.channels.push(ch);
    return ch;
  }

  async removeChannel(ch: FakeChannel) {
    this.removedChannels.push(ch);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createSignalingChannel", () => {
  let supabase: FakeSupabase;

  beforeEach(() => {
    supabase = new FakeSupabase();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("test_status_progresses_subscribing_to_subscribed", async () => {
    const sigCh = createSignalingChannel(
      supabase as unknown as Parameters<typeof createSignalingChannel>[0],
      "pair:user-1",
    );
    expect(sigCh.status).toBe("subscribing");

    // Wait for microtask queue to process the subscribe callback
    await new Promise((r) => setTimeout(r, 10));
    expect(sigCh.status).toBe("subscribed");
  });

  it("test_send_buffers_until_subscribed", async () => {
    // Channel where subscribe fires after a delay
    supabase.channel = (_name: string, _opts?: unknown) => {
      const ch = new FakeChannel();
      ch._subscribeStatus = "SUBSCRIBED";
      // Override subscribe to delay the callback
      const origSubscribe = ch.subscribe.bind(ch);
      ch.subscribe = (cb) => {
        setTimeout(() => cb?.("SUBSCRIBED"), 50);
        ch._subscribeCallback = cb ?? null;
        return ch;
      };
      supabase.channels.push(ch);
      return ch;
    };

    const sigCh = createSignalingChannel(
      supabase as unknown as Parameters<typeof createSignalingChannel>[0],
      "pair:user-1",
    );
    expect(sigCh.status).toBe("subscribing");

    // Queue a send BEFORE subscribed
    const sendPromise = sigCh.sendBroadcast("hello", {
      type: "hello",
      version: "0.2.0",
      protocol_version: "1",
      gpu: "TestGPU",
    });

    // At this point, channel not subscribed yet — should be buffered
    const ch = supabase.channels[0];
    expect(ch.sentBroadcasts).toHaveLength(0);

    // Wait for subscribe + send to resolve
    await sendPromise;

    // Now the buffered broadcast should have been sent
    expect(ch.sentBroadcasts).toHaveLength(1);
    expect(ch.sentBroadcasts[0].event).toBe("hello");
  });

  it("test_self_filter_drops_own_broadcasts", async () => {
    const tabId = "my-tab-id-xyz";
    const receivedPayloads: unknown[] = [];

    const sigCh = createSignalingChannel(
      supabase as unknown as Parameters<typeof createSignalingChannel>[0],
      "pair:user-1",
      { tabId },
    );

    sigCh.on("hello", (payload) => {
      receivedPayloads.push(payload);
    });

    await new Promise((r) => setTimeout(r, 10));

    const ch = supabase.channels[0];

    // Inject a broadcast that looks like it came from ourselves
    ch.inject("hello", {
      type: "hello",
      version: "0.2.0",
      protocol_version: "1",
      gpu: "TestGPU",
      from_tab_id: tabId, // same tab — should be filtered
    });

    // Inject a broadcast from a different tab
    ch.inject("hello", {
      type: "hello",
      version: "0.2.0",
      protocol_version: "1",
      gpu: "TestGPU",
      from_tab_id: "other-tab-id", // different tab — should pass through
    });

    expect(receivedPayloads).toHaveLength(1);
  });

  it("test_unknown_event_does_not_throw", async () => {
    const sigCh = createSignalingChannel(
      supabase as unknown as Parameters<typeof createSignalingChannel>[0],
      "pair:user-1",
    );

    await new Promise((r) => setTimeout(r, 10));

    const ch = supabase.channels[0];

    // Inject a broadcast with an invalid/unknown type — should not throw
    expect(() => {
      ch.inject("state", { type: "bogus_unknown_type" });
    }).not.toThrow();

    // No handler registered for "state" in this test — still no crash
    expect(() => {
      ch.inject("state", { type: "state", value: "idle" });
    }).not.toThrow();
  });

  it("test_close_unsubscribes_underlying_channel", async () => {
    const sigCh = createSignalingChannel(
      supabase as unknown as Parameters<typeof createSignalingChannel>[0],
      "pair:user-1",
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(sigCh.status).toBe("subscribed");

    await sigCh.close();
    expect(sigCh.status).toBe("closed");
    expect(supabase.removedChannels).toHaveLength(1);
  });

  it("on() returns an unsubscribe function", async () => {
    const received: unknown[] = [];
    const sigCh = createSignalingChannel(
      supabase as unknown as Parameters<typeof createSignalingChannel>[0],
      "pair:user-1",
    );

    const unsub = sigCh.on("state", (p) => received.push(p));

    await new Promise((r) => setTimeout(r, 10));
    const ch = supabase.channels[0];

    ch.inject("state", { type: "state", value: "idle" });
    expect(received).toHaveLength(1);

    // Unsubscribe — further messages should not fire
    unsub();
    ch.inject("state", { type: "state", value: "transcribing" });
    expect(received).toHaveLength(1);
  });
});
