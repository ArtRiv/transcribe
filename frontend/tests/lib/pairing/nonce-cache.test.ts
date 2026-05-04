// Tests for frontend/lib/pairing/nonce-cache.ts
// Verifies: issue/consume single-use semantics, TTL expiry.

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
