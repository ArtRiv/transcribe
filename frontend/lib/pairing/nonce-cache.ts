// In-memory nonce cache for Ed25519 challenge-response (signal-token route)
// and pair-init replay protection.
//
// Backing store: in-memory Map per Vercel function instance.
// Cross-instance miss is acceptable — engine retries on 401 nonce_expired/unknown.
// RESEARCH.md §Pattern 4 explicitly endorses this for the 5-min skew window.

const TTL_MS = 5 * 60 * 1000; // 5 minutes — signal-token server-issued nonces
const MAX_ENTRIES = 10_000;

// pair-init client-generated nonce constants
const NONCE_REPLAY_TTL_MS = 10 * 60 * 1000; // 10 min — wider than the JWT 5-min window to outlive any reasonable clock skew
const ISSUED_AT_SKEW_MS = 5 * 60 * 1000; // ±5 min skew tolerance

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

export type MarkSeenResult =
  | { ok: true }
  | { ok: false; reason: "replay" | "expired" | "skewed" };

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

  /**
   * Insert-if-absent for client-generated nonces (pair-init flow).
   *
   * Semantics: opposite of consume(). The nonce is engine-generated and the
   * server has never seen it — so the FIRST sighting is valid and gets recorded.
   * Any subsequent sighting with the same nonce is a replay.
   *
   * Returns ok:false if:
   *   - 'skewed'  — issued_at is outside the ±5-min clock skew window
   *   - 'replay'  — nonce was already recorded (even if not yet expired)
   *   - 'expired' — existing entry has expired (stale entry replaced on next call)
   *
   * IMPORTANT: Call this AFTER signature verification so attackers with a bad
   * signature cannot burn legitimate nonces. (WR-06 / CR-01 ordering fix.)
   */
  markSeen(
    nonce: string,
    issuedAtMs: number,
    nowMs = Date.now(),
  ): MarkSeenResult {
    if (Math.abs(nowMs - issuedAtMs) > ISSUED_AT_SKEW_MS) {
      return { ok: false, reason: "skewed" };
    }
    maybeEvict();
    const existing = cache.get(nonce);
    if (existing !== undefined) {
      if (existing < nowMs) {
        // Stale entry — replace it (idempotent for honest retries after function restart)
        cache.set(nonce, nowMs + NONCE_REPLAY_TTL_MS);
        return { ok: true };
      }
      return { ok: false, reason: "replay" };
    }
    cache.set(nonce, nowMs + NONCE_REPLAY_TTL_MS);
    return { ok: true };
  },
};
