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

// In dev, UPSTASH_REDIS_REST_URL/TOKEN are commonly absent. Without them
// Redis.fromEnv() throws, which crashes any route that calls .limit() and
// surfaces as an opaque 500. Detect the missing-env case and substitute a
// noop limiter so dev work isn't blocked. Production must keep enforcement,
// so a limited route still refuses to serve without them - see buildLimiter.
const hasUpstashEnv =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

interface LimiterLike {
  limit(key: string): Promise<{
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
  }>;
}

function buildLimiter(limit: number, prefix: string): LimiterLike {
  if (!hasUpstashEnv) {
    return {
      limit: async () => {
        // Enforcement is not optional in production - but the check belongs
        // here, at request time, not at module scope. At module scope it also
        // ran during `next build`, which evaluates route modules with
        // NODE_ENV=production and no secrets: every build without Upstash
        // credentials failed, self-hosting included, which is this project's
        // whole premise.
        if (process.env.NODE_ENV === "production") {
          throw new Error(
            "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set in production",
          );
        }
        return {
          success: true,
          limit,
          remaining: limit,
          reset: Date.now() + 60_000,
        };
      },
    };
  }
  return new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(limit, "1 m"),
    analytics: false,
    prefix,
  });
}

if (!hasUpstashEnv) {
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL/TOKEN not set — using noop limiter (dev only).",
  );
}

export const pairInitLimiter = buildLimiter(5, "rl:pair-init");
export const pairConfirmLimiter = buildLimiter(10, "rl:pair-confirm");
export const unpairLimiter = buildLimiter(10, "rl:unpair");
export const signalTokenLimiter = buildLimiter(30, "rl:signal-token");
export const signalTokenNonceLimiter = buildLimiter(60, "rl:signal-token-nonce");
export const turnCredentialsLimiter = buildLimiter(60, "rl:turn-creds");

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
