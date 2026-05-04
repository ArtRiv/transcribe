// In-memory nonce cache for Ed25519 challenge-response (signal-token route).
// Nonces are single-use, 32-byte random values, valid for 5 minutes.
//
// Backing store: in-memory Map per Vercel function instance.
// Cross-instance miss is acceptable — engine retries on 401 nonce_expired/unknown.
// RESEARCH.md §Pattern 4 explicitly endorses this for the 5-min skew window.

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 10_000;

/** Stored value is the expiry timestamp in ms. */
const cache = new Map<string, number>();

/** Sweep expired entries when cache grows large; hard-cap at MAX_ENTRIES with FIFO eviction. */
function maybeEvict(): void {
  // Sweep expired entries first
  if (cache.size > 1000) {
    const now = Date.now();
    for (const [nonce, expiresAt] of cache.entries()) {
      if (now > expiresAt) cache.delete(nonce);
    }
  }
  // Hard cap: evict oldest (insertion-order first) until under limit
  while (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export const nonceCache = {
  /**
   * Issue a new single-use nonce.
   * @returns nonce (base64url, 32 random bytes) and issued_at (ms since epoch).
   */
  issue(): { nonce: string; issued_at: number } {
    maybeEvict();
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    // base64url encode without padding for URL-safety
    const nonce = Buffer.from(bytes).toString("base64url");
    const issued_at = Date.now();
    cache.set(nonce, issued_at + TTL_MS);
    return { nonce, issued_at };
  },

  /**
   * Consume a nonce — returns true if found and not expired, then deletes it (single-use).
   * Returns false if unknown, expired, or already consumed.
   */
  consume(nonce: string): boolean {
    const expiresAt = cache.get(nonce);
    if (expiresAt === undefined) return false;
    cache.delete(nonce); // always delete — expired or valid, we don't want it reused
    if (Date.now() > expiresAt) return false;
    return true;
  },
};
