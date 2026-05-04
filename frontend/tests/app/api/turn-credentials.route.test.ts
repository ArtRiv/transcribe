// Tests for GET /api/turn-credentials
// @vitest-environment node — route uses Node.js fetch + Supabase cookie client

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks ────────────────────────────────────────────────────────────

// Mock rate limiter — succeeds by default
const mockTurnLimit = vi.fn().mockResolvedValue({ success: true });
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn().mockReturnValue({}) },
}));
vi.mock("@upstash/ratelimit", () => {
  const sw = vi.fn(() => "sw");
  const RL = vi.fn().mockImplementation(() => ({ limit: mockTurnLimit }));
  (RL as unknown as { slidingWindow: typeof sw }).slidingWindow = sw;
  return { Ratelimit: RL };
});

// Mock Supabase server client (cookie-based, for auth.getUser())
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "user-123", email: "test@example.com" } },
  error: null,
});
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

// Mock next/headers (cookies() is async in Next.js 16)
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: vi.fn(),
  }),
}));

// ── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  process.env.CLOUDFLARE_CALLS_TURN_KEY_ID = "fake-key-id";
  process.env.CLOUDFLARE_CALLS_TURN_API_TOKEN = "fake-api-token";
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  vi.resetModules();
  mockTurnLimit.mockResolvedValue({ success: true });
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-123", email: "test@example.com" } },
    error: null,
  });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CLOUDFLARE_CALLS_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_CALLS_TURN_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  // Only clear accumulated spy calls; do NOT call restoreAllMocks/clearAllMocks
  // as those would strip the RL.mockImplementation set in the vi.mock() factory.
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/turn-credentials", () => {
  it("returns 200 with iceServers on valid authenticated request", async () => {
    const fakeIceServers = [
      { urls: "turn:turn.cloudflare.com:3478", username: "u", credential: "c" },
    ];
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ iceServers: fakeIceServers }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { GET } = await import("@/app/api/turn-credentials/route");
    const req = new Request("https://vercel.app/api/turn-credentials", {
      method: "GET",
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("iceServers");
    expect(body.iceServers).toEqual(fakeIceServers);
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "not authenticated" },
    });

    const { GET } = await import("@/app/api/turn-credentials/route");
    const req = new Request("https://vercel.app/api/turn-credentials", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error", "unauthenticated");
  });

  it("returns 429 when rate limited", async () => {
    mockTurnLimit.mockResolvedValueOnce({ success: false });

    const { GET } = await import("@/app/api/turn-credentials/route");
    const req = new Request("https://vercel.app/api/turn-credentials", {
      method: "GET",
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const res = await GET(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty("error", "rate_limited");
  });

  it("returns 502 when Cloudflare TURN API fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response("upstream error", { status: 500 }),
    );

    const { GET } = await import("@/app/api/turn-credentials/route");
    const req = new Request("https://vercel.app/api/turn-credentials", {
      method: "GET",
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const res = await GET(req);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toHaveProperty("error", "turn_unavailable");
  });

  it("returns 500 on unexpected exception without leaking details", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(
      new Error("network error with secret token abc123"),
    );

    const { GET } = await import("@/app/api/turn-credentials/route");
    const req = new Request("https://vercel.app/api/turn-credentials", {
      method: "GET",
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty("error", "internal");
    expect(JSON.stringify(body)).not.toContain("network error");
    expect(JSON.stringify(body)).not.toContain("abc123");
  });

  it("does not expose CLOUDFLARE_CALLS_TURN_API_TOKEN in response", async () => {
    const fakeToken = "super-secret-cloudflare-token-xyz";
    process.env.CLOUDFLARE_CALLS_TURN_API_TOKEN = fakeToken;
    vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ iceServers: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { GET } = await import("@/app/api/turn-credentials/route");
    const req = new Request("https://vercel.app/api/turn-credentials", {
      method: "GET",
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const res = await GET(req);
    const body = await res.text();
    expect(body).not.toContain(fakeToken);
  });
});
