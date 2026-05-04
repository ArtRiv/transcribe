// Tests for POST /api/unpair
// @vitest-environment node — route uses Supabase cookie client + admin DELETE

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks ────────────────────────────────────────────────────────────

// Mock rate limiter — succeeds by default
const mockUnpairLimit = vi.fn().mockResolvedValue({ success: true });
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn().mockReturnValue({}) },
}));
vi.mock("@upstash/ratelimit", () => {
  const sw = vi.fn(() => "sw");
  const RL = vi.fn().mockImplementation(() => ({ limit: mockUnpairLimit }));
  (RL as unknown as { slidingWindow: typeof sw }).slidingWindow = sw;
  return { Ratelimit: RL };
});

// Mock Supabase server client (cookie-based, for auth.getUser())
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "user-uuid-456" } },
  error: null,
});
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: vi.fn(),
  }),
}));

// Mock admin client — DELETE from devices
const mockDeleteEq = vi.fn().mockResolvedValue({ error: null });
const mockDelete = vi.fn().mockReturnValue({ eq: mockDeleteEq });
const mockFrom = vi.fn().mockReturnValue({ delete: mockDelete });
const mockAdminClientInstance = { from: mockFrom };
vi.mock("@/lib/pairing/server", () => ({
  getSupabaseAdminClient: vi.fn(() => mockAdminClientInstance),
}));

// ── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  vi.resetModules();
  mockUnpairLimit.mockResolvedValue({ success: true });
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-uuid-456" } },
    error: null,
  });
  mockDeleteEq.mockResolvedValue({ error: null });
  mockDelete.mockReturnValue({ eq: mockDeleteEq });
  mockFrom.mockReturnValue({ delete: mockDelete });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/unpair", () => {
  it("returns 200 on successful unpair", async () => {
    const { POST } = await import("@/app/api/unpair/route");
    const req = new Request("https://vercel.app/api/unpair", {
      method: "POST",
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("ok", true);
  });

  it("DELETE targets devices table by user_id from auth (not from body)", async () => {
    const { POST } = await import("@/app/api/unpair/route");
    const req = new Request("https://vercel.app/api/unpair", {
      method: "POST",
    });
    await POST(req);
    // Called from("devices") then .delete()
    expect(mockFrom).toHaveBeenCalledWith("devices");
    expect(mockDelete).toHaveBeenCalled();
    // eq called with user_id from auth.getUser() — not from body
    expect(mockDeleteEq).toHaveBeenCalledWith("user_id", "user-uuid-456");
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "not authenticated" },
    });
    const { POST } = await import("@/app/api/unpair/route");
    const req = new Request("https://vercel.app/api/unpair", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error", "unauthenticated");
  });

  it("returns 429 when rate limited", async () => {
    mockUnpairLimit.mockResolvedValueOnce({ success: false });
    const { POST } = await import("@/app/api/unpair/route");
    const req = new Request("https://vercel.app/api/unpair", {
      method: "POST",
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty("error", "rate_limited");
  });

  it("returns 500 on unexpected DB error without leaking details", async () => {
    mockDeleteEq.mockRejectedValueOnce(
      new Error("connection error with secret password"),
    );
    const { POST } = await import("@/app/api/unpair/route");
    const req = new Request("https://vercel.app/api/unpair", {
      method: "POST",
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty("error", "internal");
    expect(JSON.stringify(body)).not.toContain("connection error");
    expect(JSON.stringify(body)).not.toContain("secret password");
  });

  it("returns 500 on DB error response (error field present)", async () => {
    mockDeleteEq.mockResolvedValueOnce({
      error: { message: "rls violation" },
    });
    const { POST } = await import("@/app/api/unpair/route");
    const req = new Request("https://vercel.app/api/unpair", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty("error", "internal");
    expect(JSON.stringify(body)).not.toContain("rls violation");
  });
});
