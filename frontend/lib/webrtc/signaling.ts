/**
 * lib/webrtc/signaling.ts — Supabase Realtime broadcast channel wrapper (Plan 08-06).
 *
 * Wraps @supabase/supabase-js Realtime channel for the signaling event-name
 * shape (description, candidate, hello, state) used by the WebRTC pairing flow.
 *
 * Features:
 *   - Buffers outbound sendBroadcast() calls until status === 'subscribed'
 *     (no silent drops while the channel is still connecting)
 *   - Filters out own broadcasts via from_tab_id (multi-tab glare — Open Q #7)
 *   - Parses inbound payloads through parseWire(); logs and skips bad messages
 *     (does NOT throw — a single bad message must not kill the channel)
 *   - Returns send/on/close API; safe for both client and Edge runtimes
 *
 * Usage:
 *   const ch = createSignalingChannel(supabase, `pair:${userId}`, { tabId });
 *   ch.on('hello', (msg) => handleEngineHello(msg));
 *   await ch.sendBroadcast('description', { sdp: offer });
 *   await ch.close();
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseWire } from "./protocol";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChannelStatus = "subscribing" | "subscribed" | "closed" | "error";

export interface SignalingChannel {
  /** Register a handler for the given event name.
   *  Returns an unsubscribe function. */
  on(event: string, handler: (payload: unknown) => void): () => void;
  /** Send a broadcast. Buffered until subscribed; flushes in order. */
  sendBroadcast(event: string, payload: Record<string, unknown>): Promise<void>;
  /** Unsubscribe from Realtime and mark the channel closed. */
  close(): Promise<void>;
  /** Current subscription status. */
  readonly status: ChannelStatus;
}

// ---------------------------------------------------------------------------
// createSignalingChannel
// ---------------------------------------------------------------------------

/**
 * Create and subscribe to a Supabase Realtime broadcast channel.
 *
 * @param supabase     Browser Supabase client (already authenticated).
 * @param channelName  e.g. 'pair:<user_id>'
 * @param opts.tabId   Per-tab UUID for self-filter; defaults to crypto.randomUUID().
 */
export function createSignalingChannel(
  supabase: SupabaseClient,
  channelName: string,
  { tabId = crypto.randomUUID() }: { tabId?: string } = {},
): SignalingChannel {
  let status: ChannelStatus = "subscribing";

  // Promise that resolves when the channel reaches SUBSCRIBED state.
  // All outbound sends await this before flushing.
  let resolveSubscribed!: () => void;
  const subscribed = new Promise<void>((resolve) => {
    resolveSubscribed = resolve;
  });

  // Per-event handler registry.
  const handlers = new Map<string, Set<(payload: unknown) => void>>();

  // Outbound buffer: queue of pending { event, payload } until subscribed.
  // Using a single shared flush queue so messages go out in order.
  type Queued = { event: string; payload: Record<string, unknown> };
  const outboundQueue: Queued[] = [];
  let flushing = false;

  // ---------------------------------------------------------------------------
  // Supabase channel setup
  // ---------------------------------------------------------------------------
  const channel = supabase.channel(channelName, {
    config: { broadcast: { self: false } },
  });

  // Universal inbound handler — registered for each event type we care about.
  function handleInbound(event: string, payload: unknown): void {
    // Self-filter: belt-and-suspenders over `self: false`
    if (
      payload !== null &&
      typeof payload === "object" &&
      "from_tab_id" in payload &&
      (payload as Record<string, unknown>)["from_tab_id"] === tabId
    ) {
      return;
    }

    // Parse through wire validator; skip bad messages without throwing
    let parsed: unknown;
    try {
      parsed = parseWire(JSON.stringify(payload));
    } catch {
      // Unknown type or malformed — log and skip
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[signaling] Dropping unrecognised inbound message on event '${event}'`,
        );
      }
      return;
    }

    const eventHandlers = handlers.get(event);
    if (eventHandlers) {
      for (const h of eventHandlers) {
        try {
          h(parsed);
        } catch (err) {
          console.error("[signaling] Handler error:", err);
        }
      }
    }
  }

  // Register handlers for all known signaling events.
  // Using a per-event registration so the fake channel in tests can fire them.
  const SIGNALING_EVENTS = [
    "hello",
    "state",
    "description",
    "candidate",
    "resume_query",
    "resume_state",
    "ping",
    "pong",
    "progress",
    "result",
    "checkpoint",
    "error",
  ];
  for (const evt of SIGNALING_EVENTS) {
    channel.on(
      "broadcast",
      { event: evt },
      ({ payload }: { payload: unknown }) => handleInbound(evt, payload),
    );
  }

  channel.subscribe((s: string) => {
    if (s === "SUBSCRIBED") {
      status = "subscribed";
      resolveSubscribed();
    } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") {
      status = "error";
    } else if (s === "CLOSED") {
      status = "closed";
    }
  });

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    get status() {
      return status;
    },

    on(event: string, handler: (payload: unknown) => void): () => void {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler);
      return () => {
        set!.delete(handler);
      };
    },

    async sendBroadcast(
      event: string,
      payload: Record<string, unknown>,
    ): Promise<void> {
      const enriched = { ...payload, from_tab_id: tabId };

      if (status !== "subscribed") {
        // Buffer outbound message; flush after subscribe
        let resolveQueued!: () => void;
        const queued = new Promise<void>((r) => {
          resolveQueued = r;
        });
        outboundQueue.push({ event, payload: enriched });

        // Flush queue when subscribed (deduplicated via flushing flag)
        subscribed.then(async () => {
          if (flushing) {
            // Another flush is in progress; our message will be picked up
            resolveQueued();
            return;
          }
          flushing = true;
          while (outboundQueue.length > 0) {
            const item = outboundQueue.shift()!;
            await channel.send({
              type: "broadcast",
              event: item.event,
              payload: item.payload,
            });
          }
          flushing = false;
          resolveQueued();
        });

        return queued;
      }

      await channel.send({
        type: "broadcast",
        event,
        payload: enriched,
      });
    },

    async close(): Promise<void> {
      await supabase.removeChannel(channel);
      status = "closed";
    },
  };
}
