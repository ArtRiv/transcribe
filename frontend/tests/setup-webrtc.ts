/**
 * setup-webrtc.ts — in-memory WebRTC mock for jsdom spike tests.
 *
 * jsdom does not ship RTCPeerConnection. This file provides a minimal mock
 * that implements enough of the perfect-negotiation contract from
 * RESEARCH.md §Pattern 1 to drive the Wave-0 spike test.
 *
 * NOT a production client — only used under tests/spike/. The real WebRTC
 * client (lib/webrtc/client.ts) ships in Plans 06+ and uses native
 * RTCPeerConnection in the browser.
 *
 * Design decisions:
 *   - SDP is represented as a plain string (no SDP parsing needed for glare tests).
 *   - signalingState transitions follow the JSEP state machine subset needed for
 *     perfect negotiation: "stable" ↔ "have-local-offer" ↔ "have-remote-offer".
 *   - The message bus is a simple callback map — no async queuing; callers drive
 *     message delivery synchronously so tests remain deterministic.
 */

export type SignalingMessage =
  | { type: "description"; sdp: FakeSDP }
  | { type: "candidate"; candidate: FakeIceCandidate };

export interface FakeSDP {
  type: "offer" | "answer";
  sdp: string;
}

export interface FakeIceCandidate {
  candidate: string;
  sdpMid: string;
  sdpMLineIndex: number;
}

/** Minimal JSEP signaling state machine. */
type SignalingState =
  | "stable"
  | "have-local-offer"
  | "have-remote-offer"
  | "closed";

type MessageHandler = (msg: SignalingMessage) => Promise<void>;

/**
 * FakePeerConnection — minimal RTCPeerConnection stand-in for glare tests.
 *
 * Implements:
 *   setLocalDescription(desc?)  — accepts offer/answer; transitions signalingState
 *   setRemoteDescription(desc)  — accepts remote offer/answer; transitions signalingState
 *   addIceCandidate(candidate)  — records buffered candidates
 *   close()                     — transitions to "closed"
 *
 * Fires:
 *   onnegotiationneeded — when told to via triggerNegotiationNeeded()
 *   onerror             — never (unless forced via triggerError())
 *
 * The mock does NOT implement ICE gathering, DTLS, SCTP, etc.
 */
export class FakePeerConnection {
  signalingState: SignalingState = "stable";
  localDescription: FakeSDP | null = null;
  remoteDescription: FakeSDP | null = null;

  /** Candidates received via addIceCandidate */
  receivedCandidates: FakeIceCandidate[] = [];

  onnegotiationneeded: (() => Promise<void>) | null = null;
  onerror: ((err: unknown) => void) | null = null;

  private _role: "polite" | "impolite";
  private _offerCounter = 0;

  constructor(role: "polite" | "impolite") {
    this._role = role;
  }

  async setLocalDescription(desc?: FakeSDP): Promise<void> {
    // If no descriptor supplied, generate one based on current state
    if (!desc) {
      if (
        this.signalingState === "stable" ||
        this.signalingState === "have-remote-offer"
      ) {
        const type =
          this.signalingState === "have-remote-offer" ? "answer" : "offer";
        this._offerCounter++;
        desc = {
          type,
          sdp: `v=0\r\no=${this._role} ${this._offerCounter} 0 IN IP4 127.0.0.1\r\n`,
        };
      } else {
        // Already have a local offer — rollback (polite peer glare resolution)
        this.signalingState = "stable";
        this.localDescription = null;
        return;
      }
    }
    this.localDescription = desc;
    if (desc.type === "offer") {
      this.signalingState = "have-local-offer";
    } else {
      // answer — stable after set
      this.signalingState = "stable";
    }
  }

  async setRemoteDescription(desc: FakeSDP): Promise<void> {
    this.remoteDescription = desc;
    if (desc.type === "offer") {
      this.signalingState = "have-remote-offer";
    } else {
      // answer — stable after set
      this.signalingState = "stable";
    }
  }

  async addIceCandidate(candidate: FakeIceCandidate): Promise<void> {
    this.receivedCandidates.push(candidate);
  }

  close(): void {
    this.signalingState = "closed";
  }

  /** Test helper — fire onnegotiationneeded to simulate the browser event. */
  async triggerNegotiationNeeded(): Promise<void> {
    if (this.onnegotiationneeded) {
      await this.onnegotiationneeded();
    }
  }

  /** Test helper — fire onerror to simulate a connection error. */
  triggerError(err: unknown): void {
    if (this.onerror) {
      this.onerror(err);
    }
  }
}

/**
 * PerfectNegotiationPeer — wraps FakePeerConnection with the exact
 * perfect-negotiation logic from RESEARCH.md §Pattern 1.
 *
 * polite=true  → frontend role (rolls back on glare)
 * polite=false → engine role  (ignores the polite peer's offer on collision)
 */
export class PerfectNegotiationPeer {
  readonly pc: FakePeerConnection;
  readonly polite: boolean;

  private makingOffer = false;
  private ignoreOffer = false;
  private _sendSignaling: ((msg: SignalingMessage) => void) | null = null;
  private _errors: unknown[] = [];

  /** Candidates buffered while ignoreOffer is true (MDN edge case). */
  candidatesSent: FakeIceCandidate[] = [];

  constructor(role: "polite" | "impolite") {
    this.pc = new FakePeerConnection(role);
    this.polite = role === "polite";
  }

  /** Wire the send channel (called by pair() below). */
  _setSend(fn: (msg: SignalingMessage) => void): void {
    this._sendSignaling = fn;
  }

  /** Initiate offer-making — mirrors pc.onnegotiationneeded handler. */
  async negotiationNeeded(): Promise<void> {
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      if (this.pc.localDescription && this._sendSignaling) {
        this._sendSignaling({
          type: "description",
          sdp: this.pc.localDescription,
        });
      }
    } finally {
      this.makingOffer = false;
    }
  }

  /** Receive a signaling message — mirrors onSignalingMessage handler. */
  async receive(msg: SignalingMessage): Promise<void> {
    try {
      if (msg.type === "description") {
        const sdp = msg.sdp;
        const offerCollision =
          sdp.type === "offer" &&
          (this.makingOffer || this.pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && offerCollision;
        if (this.ignoreOffer) return;

        if (this.polite && offerCollision) {
          // Polite peer rolls back its own local offer
          await this.pc.setLocalDescription();
        }

        await this.pc.setRemoteDescription(sdp);

        if (sdp.type === "offer") {
          await this.pc.setLocalDescription();
          if (this.pc.localDescription && this._sendSignaling) {
            this._sendSignaling({
              type: "description",
              sdp: this.pc.localDescription,
            });
          }
        }
      } else if (msg.type === "candidate") {
        try {
          await this.pc.addIceCandidate(msg.candidate);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      this._errors.push(err);
    }
  }

  /** Emit a candidate (test helper — mirrors pc.onicecandidate). */
  sendCandidate(candidate: FakeIceCandidate): void {
    this.candidatesSent.push(candidate);
    if (this._sendSignaling) {
      this._sendSignaling({ type: "candidate", candidate });
    }
  }

  get errors(): unknown[] {
    return this._errors;
  }
}

/**
 * pair(politePeer, impolitePeer) — link two PerfectNegotiationPeer instances
 * over an in-memory message bus.
 *
 * Messages are delivered by pushing them to an internal queue. Call
 * deliverPending() (or await the returned Promise) to flush all queued
 * messages — this lets tests control exactly when cross-peer delivery happens.
 *
 * Returns:
 *   deliverPending() — flush all queued messages between the two peers.
 *   deliverToPolite(msg)   — send msg directly to the polite peer's receive().
 *   deliverToImpolite(msg) — send msg directly to the impolite peer's receive().
 */
export function pair(
  politePeer: PerfectNegotiationPeer,
  impolitePeer: PerfectNegotiationPeer,
): {
  deliverPending: () => Promise<void>;
  deliverToPolite: (msg: SignalingMessage) => Promise<void>;
  deliverToImpolite: (msg: SignalingMessage) => Promise<void>;
} {
  // Each queue entry is {target, msg} — sender-agnostic delivery
  const toPoliteQueue: SignalingMessage[] = [];
  const toImpoliteQueue: SignalingMessage[] = [];

  politePeer._setSend((msg) => toImpoliteQueue.push(msg));
  impolitePeer._setSend((msg) => toPoliteQueue.push(msg));

  async function deliverPending(): Promise<void> {
    // Drain the queues in rounds until both are empty
    let rounds = 0;
    while (toPoliteQueue.length > 0 || toImpoliteQueue.length > 0) {
      if (++rounds > 100)
        throw new Error("Message delivery loop exceeded 100 rounds");

      const fromImpolite = toPoliteQueue.splice(0);
      const fromPolite = toImpoliteQueue.splice(0);

      for (const msg of fromImpolite) await politePeer.receive(msg);
      for (const msg of fromPolite) await impolitePeer.receive(msg);
    }
  }

  return {
    deliverPending,
    deliverToPolite: (msg) => politePeer.receive(msg),
    deliverToImpolite: (msg) => impolitePeer.receive(msg),
  };
}
