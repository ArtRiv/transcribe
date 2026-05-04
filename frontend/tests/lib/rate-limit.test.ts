// Tests for frontend/lib/rate-limit.ts
// Verifies: rate limiters are exported, sliding-window behaviour works with a stubbed Redis.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We stub @upstash/redis and @upstash/ratelimit BEFORE importing the module under test.
// This lets us exercise the rate-limit logic without a live Redis connection.

// Mock storage for our in-memory "Redis"
let mockStore: Map<string, { value: number; expires: number }>;

vi.mock("@upstash/redis", () => {
  return {
    Redis: {
      fromEnv: vi.fn().mockImplementation(() => ({
        pipeline: vi.fn(),
        eval: vi.fn(),
        evalsha: vi.fn(),
        // Upstash Ratelimit calls .eval() under the hood; we'll mock at a higher level.
      })),
    },
  };
});

// We mock the Ratelimit class at a level that lets us test the exported instances.
// The actual sliding-window algorithm is tested by @upstash/ratelimit's own suite.
// Here we only verify that: (1) limiters exist, (2) .limit() is callable and returns
// the expected shape, (3) a limit of N blocks on the (N+1)th call.

// Counter map for our mock
const callCounters = new Map<string, number>();

vi.mock("@upstash/ratelimit", () => {
  const slidingWindowMock = vi.fn(
    (limit: number, _window: string) =>
      `sliding-window:${limit}` as unknown as ReturnType<
        (typeof import("@upstash/ratelimit"))["Ratelimit"]["slidingWindow"]
      >,
  );

  const RatelimitMock = vi
    .fn()
    .mockImplementation((opts: { limiter: string; prefix: string }) => {
      const limitValue = parseInt(opts.limiter.split(":")[1] ?? "60", 10);
      return {
        _prefix: opts.prefix,
        _limit: limitValue,
        limit: vi.fn().mockImplementation(async (key: string) => {
          const counterKey = `${opts.prefix}:${key}`;
          const current = (callCounters.get(counterKey) ?? 0) + 1;
          callCounters.set(counterKey, current);
          const success = current <= limitValue;
          return {
            success,
            limit: limitValue,
            remaining: Math.max(0, limitValue - current),
            reset: Date.now() + 60_000,
          };
        }),
      };
    });

  (
    RatelimitMock as unknown as { slidingWindow: typeof slidingWindowMock }
  ).slidingWindow = slidingWindowMock;

  return { Ratelimit: RatelimitMock };
});

beforeEach(() => {
  callCounters.clear();
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
});

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  vi.resetModules();
});

describe("rate-limit exports", () => {
  it("exports all five limiters", async () => {
    const mod = await import("@/lib/rate-limit");
    expect(mod.pairInitLimiter).toBeDefined();
    expect(mod.pairConfirmLimiter).toBeDefined();
    expect(mod.signalTokenLimiter).toBeDefined();
    expect(mod.signalTokenNonceLimiter).toBeDefined();
    expect(mod.turnCredentialsLimiter).toBeDefined();
  });

  it("exports getClientKey", async () => {
    const mod = await import("@/lib/rate-limit");
    expect(typeof mod.getClientKey).toBe("function");
  });
});

describe("getClientKey", () => {
  it("returns cf-connecting-ip when present", async () => {
    const { getClientKey } = await import("@/lib/rate-limit");
    const req = new Request("https://example.com", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    expect(getClientKey(req, "fallback")).toBe("1.2.3.4");
  });

  it("falls back to x-forwarded-for first IP", async () => {
    const { getClientKey } = await import("@/lib/rate-limit");
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "5.6.7.8, 9.10.11.12" },
    });
    expect(getClientKey(req, "fallback")).toBe("5.6.7.8");
  });

  it("falls back to provided fallback when no IP headers", async () => {
    const { getClientKey } = await import("@/lib/rate-limit");
    const req = new Request("https://example.com");
    expect(getClientKey(req, "127.0.0.1")).toBe("127.0.0.1");
  });
});

describe("pairInitLimiter — 5 req/min limit", () => {
  it("allows first 5 requests and blocks the 6th", async () => {
    const { pairInitLimiter } = await import("@/lib/rate-limit");
    for (let i = 1; i <= 5; i++) {
      const result = await pairInitLimiter.limit("test-ip");
      expect(result.success).toBe(true);
    }
    const blocked = await pairInitLimiter.limit("test-ip");
    expect(blocked.success).toBe(false);
  });
});
