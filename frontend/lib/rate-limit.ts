// Upstash sliding-window rate limiter instances — single source of truth for all
// Phase 8 route limits. Route handlers import individual limiters from here.
//
// Rate limits per RESEARCH.md §Open Questions #3 and §Don't Hand-Roll:
//   pair-init:          5 req / 1 min / IP
//   pair-confirm:       10 req / 1 min / user_id  (D-21)
//   unpair:             10 req / 1 min / user_id  (D-21; own budget, independent of pair-confirm)
//   signal-token:       30 req / 1 min / pubkey
//   signal-token-nonce: 60 req / 1 min / IP
//   turn-credentials:   60 req / 1 min / user_id  (D-21)

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN

export const pairInitLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "1 m"),
  analytics: false,
  prefix: "rl:pair-init",
});

export const pairConfirmLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  analytics: false,
  prefix: "rl:pair-confirm",
});

export const unpairLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
  analytics: false,
  prefix: "rl:unpair",
});

export const signalTokenLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  analytics: false,
  prefix: "rl:signal-token",
});

export const signalTokenNonceLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "1 m"),
  analytics: false,
  prefix: "rl:signal-token-nonce",
});

export const turnCredentialsLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, "1 m"),
  analytics: false,
  prefix: "rl:turn-creds",
});

/**
 * Extract a client IP address from request headers for rate-limit keying.
 * Priority: cf-connecting-ip (Cloudflare) → x-forwarded-for[0] → fallback.
 */
export function getClientKey(request: Request, fallback: string): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0];
    if (first) return first.trim();
  }

  return fallback;
}
