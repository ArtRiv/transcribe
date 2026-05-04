// Tests for GET /api/signal-token/nonce
// @vitest-environment node — route handler uses Node.js APIs

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the route handler
vi.mock("@/lib/pairing/nonce-cache", () => ({
  nonceCache: {
    issue: vi.fn(() => ({
      nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      issued_at: 1000000000000,
    })),
    consume: vi.fn(),
  },
}));

vi.mock("@upstash/redis", () => ({
  Redis: {
    fromEnv: vi.fn().mockReturnValue({}),
  },
}));

let callCount = 0;
vi.mock("@upstash/ratelimit", () => {
  const slidingWindowMock = vi.fn(() => "sw");
  const RatelimitMock = vi.fn().mockImplementation(() => ({
    limit: vi.fn().mockImplementation(async (_key: string) => {
      callCount++;
      // Simulate: first 60 succeed, 61st is blocked (per signalTokenNonceLimiter = 60/min)
      return { success: callCount <= 60 };
    }),
  }));
  (
    RatelimitMock as unknown as { slidingWindow: typeof slidingWindowMock }
  ).slidingWindow = slidingWindowMock;
  return { Ratelimit: RatelimitMock };
});

beforeEach(() => {
  callCount = 0;
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  vi.resetModules();
});

afterEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.resetModules();
});

describe("GET /api/signal-token/nonce", () => {
  it("returns 200 with nonce and issued_at on success", async () => {
    const { GET } = await import("@/app/api/signal-token/nonce/route");
    const req = new Request("https://vercel.app/api/signal-token/nonce", {
      method: "GET",
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("nonce");
    expect(body).toHaveProperty("issued_at");
    expect(typeof body.nonce).toBe("string");
    expect(typeof body.issued_at).toBe("number");
  });

  it("returns 429 when rate limit exceeded", async () => {
    // Set callCount high so next call fails
    callCount = 60;
    const { GET } = await import("@/app/api/signal-token/nonce/route");
    const req = new Request("https://vercel.app/api/signal-token/nonce", {
      method: "GET",
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const res = await GET(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty("error", "rate_limited");
  });
});
