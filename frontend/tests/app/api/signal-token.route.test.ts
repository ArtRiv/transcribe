// Tests for POST /api/signal-token
// @vitest-environment node — route handler uses Node.js crypto, jose, noble-ed25519

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TEST_PUBKEY_HEX, signMessage } from "./_fixtures";

// ── Module mocks ────────────────────────────────────────────────────────────

const mockNonceIssue = vi.fn(() => ({
  nonce: "testnonce",
  issued_at: Date.now(),
}));
const mockNonceConsume = vi.fn(() => true);

vi.mock("@/lib/pairing/nonce-cache", () => ({
  nonceCache: {
    issue: mockNonceIssue,
    consume: mockNonceConsume,
  },
}));

// Mock admin client — device found by default
const mockDeviceRow = {
  user_id: "550e8400-e29b-41d4-a716-446655440000",
  pubkey: TEST_PUBKEY_HEX,
};
const mockSingle = vi.fn().mockResolvedValue({
  data: mockDeviceRow,
  error: null,
});
const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
const mockAdminClientInstance = { from: mockFrom };
vi.mock("@/lib/pairing/server", () => ({
  getSupabaseAdminClient: vi.fn(() => mockAdminClientInstance),
}));

// Mock rate limiter — succeeds by default
const mockLimit = vi.fn().mockResolvedValue({ success: true });
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn().mockReturnValue({}) },
}));
vi.mock("@upstash/ratelimit", () => {
  const sw = vi.fn(() => "sw");
  const RL = vi.fn().mockImplementation(() => ({ limit: mockLimit }));
  (RL as unknown as { slidingWindow: typeof sw }).slidingWindow = sw;
  return { Ratelimit: RL };
});

// ── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  process.env.SUPABASE_REALTIME_JWT_SECRET =
    "not-a-real-secret-32-chars-min-for-hs256-tests-only";
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  vi.resetModules();
  mockNonceConsume.mockReturnValue(true);
  mockLimit.mockResolvedValue({ success: true });
  mockSingle.mockResolvedValue({ data: mockDeviceRow, error: null });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_REALTIME_JWT_SECRET;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function makeValidRequest(): Promise<Request> {
  const issued_at = Date.now();
  const nonce = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const message = `signal-token:${nonce}:${issued_at}`;
  const signature = await signMessage(message);
  return new Request("https://vercel.app/api/signal-token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "1.2.3.4",
    },
    body: JSON.stringify({
      pubkey: TEST_PUBKEY_HEX,
      nonce,
      signature,
      issued_at,
    }),
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/signal-token", () => {
  it("returns 200 with token, channel, supabase_url on valid request", async () => {
    const { POST } = await import("@/app/api/signal-token/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("token");
    expect(body).toHaveProperty("channel");
    expect(body).toHaveProperty("supabase_url");
    expect(body.channel).toBe(`pair:${mockDeviceRow.user_id}`);
    expect(typeof body.token).toBe("string");
    // JWT has 3 parts
    expect(body.token.split(".").length).toBe(3);
  });

  it("returns 429 when rate limited", async () => {
    mockLimit.mockResolvedValue({ success: false });
    const { POST } = await import("@/app/api/signal-token/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty("error", "rate_limited");
  });

  it("returns 400 on missing body fields", async () => {
    const { POST } = await import("@/app/api/signal-token/route");
    const req = new Request("https://vercel.app/api/signal-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey: TEST_PUBKEY_HEX }), // missing nonce, signature, issued_at
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error", "bad_request");
  });

  it("returns 401 when nonce is expired (issued_at > 5 min ago)", async () => {
    const { POST } = await import("@/app/api/signal-token/route");
    const issued_at = Date.now() - 6 * 60 * 1000; // 6 minutes ago
    const nonce = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const message = `signal-token:${nonce}:${issued_at}`;
    const signature = await signMessage(message);
    const req = new Request("https://vercel.app/api/signal-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pubkey: TEST_PUBKEY_HEX,
        nonce,
        signature,
        issued_at,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error", "nonce_expired");
  });

  it("returns 401 when nonce is not in cache (unknown/already consumed)", async () => {
    mockNonceConsume.mockReturnValue(false);
    const { POST } = await import("@/app/api/signal-token/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error", "invalid_nonce");
  });

  it("returns 404 device_not_found when device row missing (engine unpair signal — PAIR-06)", async () => {
    mockSingle.mockResolvedValue({
      data: null,
      error: { message: "not found", code: "PGRST116" },
    });
    const { POST } = await import("@/app/api/signal-token/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty("error", "device_not_found");
  });

  it("returns 401 when signature is invalid", async () => {
    const { POST } = await import("@/app/api/signal-token/route");
    const issued_at = Date.now();
    const nonce = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    // Use a valid format but wrong signature (all zeros)
    const badSig = "0".repeat(128); // 64 bytes of zeros in hex
    const req = new Request("https://vercel.app/api/signal-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pubkey: TEST_PUBKEY_HEX,
        nonce,
        signature: badSig,
        issued_at,
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error", "invalid_signature");
  });

  it("returns generic error copy — no stack traces in error responses", async () => {
    // Even for server errors, body should only have { error: string }
    mockSingle.mockRejectedValue(
      new Error("internal DB error with secret data"),
    );
    const { POST } = await import("@/app/api/signal-token/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    // Should be 5xx and generic
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    // No stack trace, no DB error string in body
    expect(JSON.stringify(body)).not.toContain("internal DB error");
    expect(JSON.stringify(body)).not.toContain("stack");
  });
});
