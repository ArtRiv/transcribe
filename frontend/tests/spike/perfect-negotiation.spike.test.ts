/**
 * Wave-0 spike: Perfect negotiation glare resolution (frontend, polite peer).
 *
 * Validates assumption from RESEARCH.md §Pattern 1:
 *   "The polite peer rolls back its own offer on collision and accepts the
 *   impolite peer's offer, both reaching signalingState === 'stable'."
 *
 * Uses in-memory FakePeerConnection + PerfectNegotiationPeer mocks from
 * tests/setup-webrtc.ts — no real WebRTC stack or network needed in jsdom.
 *
 * RESEARCH.md citation: §Pattern 1 (lines 290-335), MDN perfect negotiation guide.
 */

import { describe, it, expect } from "vitest";
import {
  PerfectNegotiationPeer,
  pair,
  type FakeIceCandidate,
} from "../setup-webrtc";

describe("Wave-0: Perfect Negotiation Spike", () => {
  it("polite peer rolls back on glare — both peers reach stable", async () => {
    // Arrange: polite = frontend, impolite = engine (RESEARCH.md §Pattern 1)
    const polite = new PerfectNegotiationPeer("polite");
    const impolite = new PerfectNegotiationPeer("impolite");
    const { deliverPending } = pair(polite, impolite);

    // Act: both peers fire negotiationneeded simultaneously (glare scenario).
    //
    // In the real browser, this happens when both sides add data channels or
    // renegotiate at the same time. The polite peer MUST roll back; the
    // impolite peer MUST ignore the polite peer's offer.
    //
    // Step 1: Both peers generate their local offers (queued, not yet delivered).
    await polite.negotiationNeeded(); // → queues offer to impolite
    await impolite.negotiationNeeded(); // → queues offer to polite
    //   At this point both peers are in have-local-offer; offers are queued.

    // Step 2: Deliver the cross-peer messages (simulates signaling channel delivery).
    //   - Polite peer receives impolite's offer: detects offerCollision
    //     (makingOffer would have been true during negotiationNeeded, but since
    //     we finished that step, we check signalingState !== 'stable'):
    //     polite rolls back, accepts impolite's offer, sends answer.
    //   - Impolite peer receives polite's offer: ignoreOffer=true (impolite is
    //     in have-local-offer and is impolite), so it discards polite's offer.
    //   - After polite sends an answer, impolite receives it → stable.
    await deliverPending();

    // Assert: both peers must end up in stable state after the glare dance.
    expect(polite.pc.signalingState).toBe("stable");
    expect(impolite.pc.signalingState).toBe("stable");

    // No errors on either side
    expect(polite.errors).toHaveLength(0);
    expect(impolite.errors).toHaveLength(0);
  });

  it("ICE candidate buffering during glare does not lose candidates", async () => {
    // Arrange
    const polite = new PerfectNegotiationPeer("polite");
    const impolite = new PerfectNegotiationPeer("impolite");
    const { deliverPending } = pair(polite, impolite);

    // Trigger glare negotiation and resolve it
    await polite.negotiationNeeded();
    await impolite.negotiationNeeded();
    await deliverPending(); // both peers now stable

    // Both peers are now stable — send 5 ICE candidates from each side
    const makeCandidates = (prefix: string): FakeIceCandidate[] =>
      Array.from({ length: 5 }, (_, i) => ({
        candidate: `candidate:${prefix}-${i} 1 udp 12345${i} 192.168.1.${i} 5000${i} typ srflx`,
        sdpMid: "0",
        sdpMLineIndex: 0,
      }));

    const politeCandidates = makeCandidates("polite");
    const impoliteCandidates = makeCandidates("impolite");

    // Polite peer sends 5 candidates → impolite peer receives them
    for (const c of politeCandidates) {
      polite.sendCandidate(c);
    }
    // Impolite peer sends 5 candidates → polite peer receives them
    for (const c of impoliteCandidates) {
      impolite.sendCandidate(c);
    }

    // Flush candidate delivery
    await deliverPending();

    // Assert: every candidate sent by polite arrives at impolite and vice versa
    expect(impolite.pc.receivedCandidates).toHaveLength(5);
    expect(polite.pc.receivedCandidates).toHaveLength(5);

    // Verify candidate identity (no mutation or reordering)
    for (let i = 0; i < 5; i++) {
      expect(impolite.pc.receivedCandidates[i].candidate).toBe(
        politeCandidates[i].candidate,
      );
      expect(polite.pc.receivedCandidates[i].candidate).toBe(
        impoliteCandidates[i].candidate,
      );
    }

    expect(polite.errors).toHaveLength(0);
    expect(impolite.errors).toHaveLength(0);
  });

  it("NEVER throws if SDP arrives before remote description set", async () => {
    // Edge case from MDN perfect-negotiation guide:
    //   A candidate may arrive on the wire before the remote description has
    //   been set (timing: candidate trickles from signaling before offer/answer
    //   exchange completes). The addIceCandidate() call must not throw in this
    //   case when ignoreOffer is true (impolite peer during glare).
    //
    // In our mock: impolite peer receives the polite peer's offer while already
    // making its own offer → sets ignoreOffer=true. Then a candidate arrives
    // from the polite peer. The addIceCandidate() throws internally (no remote
    // desc set) but MUST be swallowed because ignoreOffer is true.

    const polite = new PerfectNegotiationPeer("polite");
    const impolite = new PerfectNegotiationPeer("impolite");

    // Do NOT use pair() — drive message delivery manually for precise timing control
    polite._setSend(() => {
      /* discard — polite's messages go nowhere */
    });
    impolite._setSend(() => {
      /* discard — impolite's messages go nowhere */
    });

    // Put impolite into have-local-offer state
    await impolite.negotiationNeeded();
    expect(impolite.pc.signalingState).toBe("have-local-offer");

    // Now deliver polite's offer to impolite — this triggers ignoreOffer=true
    // because impolite is already in have-local-offer and is the impolite peer
    const politeOffer = {
      type: "offer" as const,
      sdp: "v=0\r\no=polite 1 0 IN IP4 127.0.0.1\r\n",
    };
    await impolite.receive({ type: "description", sdp: politeOffer });

    // impolite should have ignored the offer (remoteDescription still null)
    expect(impolite.pc.remoteDescription).toBeNull();

    // Now send a candidate — this must NOT throw even though remote desc is null.
    // In a real PC, addIceCandidate() before setRemoteDescription() throws;
    // the perfect-negotiation pattern swallows it when ignoreOffer is true.
    const earlyCandidate: FakeIceCandidate = {
      candidate: "candidate:early 1 udp 123456 192.168.1.1 50000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };

    // Must not throw; impolite.errors must remain empty
    await impolite.receive({ type: "candidate", candidate: earlyCandidate });

    expect(impolite.errors).toHaveLength(0);
  });
});
