/**
 * lib/webrtc/client.ts — WebRTCEngineClient (Plan 08-07 Task 3).
 *
 * Polite-peer RTCPeerConnection wrapper + perfect-negotiation protocol.
 * Frontend is the polite peer; engine is the impolite peer.
 *
 * Pattern source: RESEARCH.md §Pattern 1 (lines 290-335).
 *
 * T-08-07-04: DTLS certificate fingerprints are exchanged inside SDP;
 * this class does not handle them manually.
 */

import type { SignalingChannel } from "./signaling";
import type { SdpDescription } from "./protocol";

/** Connection state values exposed to the UI (Plan 08 component needs these). */
export type WebRTCConnectionState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

/**
 * WebRTCEngineClient — polite peer + single ordered reliable RTCDataChannel.
 *
 * Usage:
 *   const client = new WebRTCEngineClient(signalingChannel);
 *   const channel = await client.connect();
 *   // channel is open and ready for sendAudioChunked
 */
export class WebRTCEngineClient {
  private _signalingChannel: SignalingChannel;
  private _pc: RTCPeerConnection | null = null;
  private _dataChannel: RTCDataChannel | null = null;
  private _connectionStateHandlers: Array<
    (state: WebRTCConnectionState) => void
  > = [];

  // Perfect-negotiation state (per RESEARCH.md §Pattern 1)
  private _makingOffer = false;
  private _ignoreOffer = false;
  private readonly _polite = true; // frontend is always polite

  constructor(signalingChannel: SignalingChannel) {
    this._signalingChannel = signalingChannel;
  }

  /**
   * Connect: fetch TURN creds, build PeerConnection, create DataChannel,
   * wire perfect-negotiation handlers, return the open DataChannel.
   *
   * Resolves when the data channel reaches `open` state.
   */
  async connect(): Promise<RTCDataChannel> {
    const iceServers = await this._fetchIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    this._pc = pc;

    // Single ordered+reliable data channel (D-07 — no two-channel split).
    const dc = pc.createDataChannel("transcribe", { ordered: true });
    this._dataChannel = dc;

    // --- Perfect negotiation: polite peer (RESEARCH.md §Pattern 1) ---
    pc.onnegotiationneeded = async () => {
      try {
        this._makingOffer = true;
        await pc.setLocalDescription();
        const desc = pc.localDescription;
        if (desc) {
          await this._signalingChannel.sendBroadcast("description", {
            type: "description",
            sdp: { type: desc.type, sdp: desc.sdp },
          });
        }
      } catch (err) {
        console.error("[WebRTCEngineClient] onnegotiationneeded error:", err);
      } finally {
        this._makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        void this._signalingChannel.sendBroadcast("candidate", {
          type: "candidate",
          candidate: {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
          },
        });
      }
    };

    // --- Signaling channel inbound handlers ---
    this._signalingChannel.on("description", async (payload: unknown) => {
      const msg = payload as { sdp: SdpDescription };
      if (!msg?.sdp) return;
      const sdp = msg.sdp;
      try {
        const offerCollision =
          sdp.type === "offer" &&
          (this._makingOffer || pc.signalingState !== "stable");
        this._ignoreOffer = !this._polite && offerCollision;
        if (this._ignoreOffer) return;

        if (this._polite && offerCollision) {
          // Polite peer rolls back its own local offer
          await pc.setLocalDescription({ type: "rollback" });
        }

        await pc.setRemoteDescription(new RTCSessionDescription(sdp));

        if (sdp.type === "offer") {
          await pc.setLocalDescription();
          const answer = pc.localDescription;
          if (answer) {
            await this._signalingChannel.sendBroadcast("description", {
              type: "description",
              sdp: { type: answer.type, sdp: answer.sdp },
            });
          }
        }
      } catch (err) {
        console.error("[WebRTCEngineClient] description handler error:", err);
      }
    });

    this._signalingChannel.on("candidate", async (payload: unknown) => {
      const msg = payload as { candidate?: RTCIceCandidateInit };
      if (!msg?.candidate) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      } catch (err) {
        if (!this._ignoreOffer) {
          console.error("[WebRTCEngineClient] addIceCandidate error:", err);
        }
      }
    });

    // CR-06: set pc.onconnectionstatechange EXACTLY ONCE — the handler
    // is installed here and never reassigned.  A `connectResolved` flag
    // (shared via closure) prevents stale reject() calls after the promise
    // has already settled.  The Promise executor is synchronous, so
    // `rejectConnect` is populated before any async event can fire.
    let connectResolved = false;
    let rejectConnect!: (err: Error) => void;

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState as WebRTCConnectionState;
      for (const h of this._connectionStateHandlers) {
        try {
          h(state);
        } catch {
          /* ignore handler errors */
        }
      }
      if (!connectResolved && (state === "failed" || state === "closed")) {
        connectResolved = true;
        rejectConnect(
          new Error(`Connection ${state} before data channel opened`),
        );
      }
    };

    // Wait for the data channel to open.
    return new Promise<RTCDataChannel>((resolve, reject) => {
      // Wire up rejectConnect so the onconnectionstatechange handler above
      // can reject the promise.  Promise executor is synchronous — this
      // assignment happens before any events can fire.
      rejectConnect = reject;
      dc.onopen = () => {
        connectResolved = true;
        resolve(dc);
      };
      dc.onerror = (ev) => {
        connectResolved = true;
        reject(new Error(`DataChannel error: ${String(ev)}`));
      };
    });
  }

  /**
   * Close: close data channel, PC, and signaling channel.
   */
  async close(): Promise<void> {
    try {
      this._dataChannel?.close();
    } catch {
      /* ignore */
    }
    try {
      this._pc?.close();
    } catch {
      /* ignore */
    }
    try {
      await this._signalingChannel.close();
    } catch {
      /* ignore */
    }
    this._pc = null;
    this._dataChannel = null;
  }

  /**
   * Register a handler for RTCPeerConnection connectionState changes.
   * Returns an unsubscribe function.
   */
  onConnectionStateChange(
    handler: (state: WebRTCConnectionState) => void,
  ): () => void {
    this._connectionStateHandlers.push(handler);
    return () => {
      this._connectionStateHandlers = this._connectionStateHandlers.filter(
        (h) => h !== handler,
      );
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _fetchIceServers(): Promise<RTCIceServer[]> {
    const iceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
    ];
    try {
      const resp = await fetch("/api/turn-credentials");
      if (resp.ok) {
        const data = (await resp.json()) as {
          iceServers?: RTCIceServer[];
          urls?: string;
          username?: string;
          credential?: string;
        };
        if (Array.isArray(data.iceServers)) {
          return data.iceServers;
        }
        if (data.urls) {
          iceServers.push({
            urls: data.urls,
            username: data.username,
            credential: data.credential,
          });
        }
      }
    } catch (err) {
      console.warn("[WebRTCEngineClient] TURN fetch failed — STUN only:", err);
    }
    return iceServers;
  }
}
