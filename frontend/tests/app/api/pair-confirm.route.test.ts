// Tests for POST /api/pair-confirm
// @vitest-environment node — route uses Supabase cookie client + RPC

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks ────────────────────────────────────────────────────────────

// Mock rate limiter — succeeds by default
const mockConfirmLimit = vi.fn().mockResolvedValue({ success: true });
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn().mockReturnValue({}) },
}));
vi.mock("@upstash/ratelimit", () => {
  const sw = vi.fn(() => "sw");
  const RL = vi.fn().mockImplementation(() => ({ limit: mockConfirmLimit }));
  (RL as unknown as { slidingWindow: typeof sw }).slidingWindow = sw;
  return { Ratelimit: RL };
});

// Mock Supabase server client (cookie-based, for auth.getUser())
const mockGetUser = vi.fn().mockResolvedValue({
  data: { user: { id: "user-uuid-123" } },
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

// Mock admin client with RPC support (B-03 — only rpc() is called)
const mockRpc = vi.fn().mockResolvedValue({
  data: [
    {
      success: true,
      conflict: false,
      existing_name: null,
      existing_gpu: null,
      existing_seen: null,
    },
  ],
  error: null,
});
const mockAdminClientInstance = { rpc: mockRpc };
vi.mock("@/lib/pairing/server", () => ({
  getSupabaseAdminClient: vi.fn(() => mockAdminClientInstance),
}));

// ── Setup / teardown ────────────────────────────────────────────────────────

const VALID_CODE = "ABCD-1234";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  vi.resetModules();
  mockRpc.mockClear();
  mockConfirmLimit.mockResolvedValue({ success: true });
  mockGetUser.mockResolvedValue({
    data: { user: { id: "user-uuid-123" } },
    error: null,
  });
  mockRpc.mockResolvedValue({
    data: [
      {
        success: true,
        conflict: false,
        existing_name: null,
        existing_gpu: null,
        existing_seen: null,
      },
    ],
    error: null,
  });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/pair-confirm", () => {
  it("returns 200 on successful pair (success=true)", async () => {
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-connecting-ip": "1.2.3.4",
      },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("ok", true);
  });

  it("calls ONLY rpc('pair_confirm_atomic') — no direct table DML (B-03)", async () => {
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    await POST(req);

    // B-03: exactly one RPC call made
    expect(mockRpc).toHaveBeenCalledWith(
      "pair_confirm_atomic",
      expect.any(Object),
    );

    // B-03: admin client has no .from() call (no direct table DML)
    expect(mockAdminClientInstance).not.toHaveProperty("from");
  });

  it("passes _user from auth.uid() (not from body) to the RPC (T-08-04b-03)", async () => {
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    await POST(req);
    expect(mockRpc).toHaveBeenCalledWith(
      "pair_confirm_atomic",
      expect.objectContaining({ _user: "user-uuid-123" }),
    );
  });

  it("forwards replace=true to RPC when provided", async () => {
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: VALID_CODE, replace: true }),
    });
    await POST(req);
    expect(mockRpc).toHaveBeenCalledWith(
      "pair_confirm_atomic",
      expect.objectContaining({ _replace: true }),
    );
  });

  it("returns 409 with existing device info when conflict=true", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          success: false,
          conflict: true,
          existing_name: "My Engine",
          existing_gpu: "RX 6600",
          existing_seen: "2026-05-04T10:00:00Z",
        },
      ],
      error: null,
    });
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toHaveProperty("error", "device_conflict");
    expect(body).toHaveProperty("existing");
    expect(body.existing).toMatchObject({
      name: "My Engine",
      gpu: "RX 6600",
      last_seen: "2026-05-04T10:00:00Z",
    });
  });

  it("returns 410 when pending row is missing or expired (success=false, conflict=false)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          success: false,
          conflict: false,
          existing_name: null,
          existing_gpu: null,
          existing_seen: null,
        },
      ],
      error: null,
    });
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    const res = await POST(req);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body).toHaveProperty("error", "expired_or_unknown");
  });

  it("returns 500 with fixed copy when RPC returns empty array (WR-05)", async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty("error", "internal");
  });

  it("returns 500 (not a fallback retry) when RPC returns an error (B-03)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: "rpc failed" },
    });
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty("error", "internal");
    // B-03: only one RPC call — no retry/fallback
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when user is not authenticated", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: "not authenticated" },
    });
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error", "unauthenticated");
  });

  it("returns 400 when code format is invalid", async () => {
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "bad-code" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error", "bad_request");
  });

  it("returns 429 when rate limited", async () => {
    mockConfirmLimit.mockResolvedValueOnce({ success: false });
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty("error", "rate_limited");
  });

  it("returns generic error — no DB error strings in 500 response", async () => {
    mockRpc.mockRejectedValueOnce(
      new Error("postgres error: secret_table_name constraint violation"),
    );
    const { POST } = await import("@/app/api/pair-confirm/route");
    const req = new Request("https://vercel.app/api/pair-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: VALID_CODE }),
    });
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("secret_table_name");
    expect(JSON.stringify(body)).not.toContain("postgres error");
  });
});
