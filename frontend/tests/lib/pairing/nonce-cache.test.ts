// Tests for frontend/lib/pairing/nonce-cache.ts
// Verifies: issue/consume single-use semantics, TTL expiry, markSeen replay protection.

import { describe, it, expect, vi, afterEach } from "vitest";

// We need to import after potential module resets
import { nonceCache } from "@/lib/pairing/nonce-cache";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("nonceCache", () => {
  it("issue() returns an object with nonce and issued_at", () => {
    const result = nonceCache.issue();
    expect(result).toHaveProperty("nonce");
    expect(result).toHaveProperty("issued_at");
    expect(typeof result.nonce).toBe("string");
    expect(typeof result.issued_at).toBe("number");
    // nonce should be base64url — only URL-safe chars
    expect(result.nonce).toMatch(/^[A-Za-z0-9\-_=]+$/);
  });

  it("issue() returns distinct nonces on repeated calls", () => {
    const a = nonceCache.issue();
    const b = nonceCache.issue();
    expect(a.nonce).not.toBe(b.nonce);
  });

  it("consume() returns true for a freshly issued nonce", () => {
    const { nonce } = nonceCache.issue();
    expect(nonceCache.consume(nonce)).toBe(true);
  });

  it("consume() returns false on second consume (single-use)", () => {
    const { nonce } = nonceCache.issue();
    nonceCache.consume(nonce); // first use
    expect(nonceCache.consume(nonce)).toBe(false);
  });

  it("consume() returns false for an unknown nonce", () => {
    expect(nonceCache.consume("definitely-not-a-real-nonce")).toBe(false);
  });

  it("consume() returns false for an expired nonce", () => {
    vi.useFakeTimers();
    const { nonce } = nonceCache.issue();
    // Advance time past the 5-minute TTL
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(nonceCache.consume(nonce)).toBe(false);
  });

  it("nonce is 32 bytes encoded as base64url (43–44 chars)", () => {
    const { nonce } = nonceCache.issue();
    // 32 bytes in base64url = ceil(32 * 4 / 3) = 43 or 44 chars (with/without padding)
    expect(nonce.length).toBeGreaterThanOrEqual(43);
    expect(nonce.length).toBeLessThanOrEqual(44);
  });

  it("hard cap: issuing 10,001 nonces via markSeen evicts the first one (memory-DoS guard)", () => {
    // markSeen inserts into the same underlying cache and respects MAX_ENTRIES.
    const firstBatch: string[] = [];
    const MAX_ENTRIES = 10_000;
    const now = Date.now();
    for (let i = 0; i < MAX_ENTRIES + 1; i++) {
      const nonce = `markseen-nonce-${i}-${Math.random()}`;
      nonceCache.markSeen(nonce, now, now);
      firstBatch.push(nonce);
    }
    // The very first nonce we markSeen'd should have been FIFO-evicted
    const firstNonce = firstBatch[0];
    // A second markSeen of the evicted nonce should succeed (treated as fresh)
    const result = nonceCache.markSeen(firstNonce, now, now);
    expect(result.ok).toBe(true);
  });

  it("hard cap: issuing 10,001 nonces evicts the first one (memory-DoS guard)", () => {
    // Fill cache to 10,000 entries; issue one more — oldest must be evicted.
    // Cache is module-level so we fill from current size. This test is intentionally
    // last in the suite to avoid interfering with other tests.
    const firstBatch: string[] = [];
    const MAX_ENTRIES = 10_000;
    // Issue enough to reach MAX_ENTRIES (some entries may already exist from prior tests)
    for (let i = 0; i < MAX_ENTRIES + 1; i++) {
      const { nonce } = nonceCache.issue();
      firstBatch.push(nonce);
    }
    // The very first nonce we issued should have been evicted
    const firstNonce = firstBatch[0];
    // consume() returns false for evicted entries (not in cache)
    expect(nonceCache.consume(firstNonce)).toBe(false);
  });
});

describe("nonceCache.markSeen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns ok:true for a fresh nonce with valid issued_at", () => {
    const now = Date.now();
    const nonce = `fresh-${Math.random()}`;
    const result = nonceCache.markSeen(nonce, now, now);
    expect(result).toEqual({ ok: true });
  });

  it("returns ok:false reason:'replay' for a nonce already seen", () => {
    const now = Date.now();
    const nonce = `replay-${Math.random()}`;
    nonceCache.markSeen(nonce, now, now); // first sighting — ok
    const result = nonceCache.markSeen(nonce, now, now); // replay
    expect(result).toEqual({ ok: false, reason: "replay" });
  });

  it("returns ok:false reason:'skewed' when issued_at is in the far future", () => {
    const now = Date.now();
    const farFuture = now + 6 * 60 * 1000; // 6 min ahead — outside ±5 min
    const nonce = `future-${Math.random()}`;
    const result = nonceCache.markSeen(nonce, farFuture, now);
    expect(result).toEqual({ ok: false, reason: "skewed" });
  });

  it("returns ok:false reason:'skewed' when issued_at is in the far past", () => {
    const now = Date.now();
    const farPast = now - 6 * 60 * 1000; // 6 min ago — outside ±5 min
    const nonce = `past-${Math.random()}`;
    const result = nonceCache.markSeen(nonce, farPast, now);
    expect(result).toEqual({ ok: false, reason: "skewed" });
  });

  it("accepts issued_at at the edge of the ±5-min window (boundary)", () => {
    const now = Date.now();
    const edgeMs = now - 5 * 60 * 1000; // exactly 5 min — equal, not over
    const nonce = `edge-${Math.random()}`;
    const result = nonceCache.markSeen(nonce, edgeMs, now);
    expect(result.ok).toBe(true);
  });
});
