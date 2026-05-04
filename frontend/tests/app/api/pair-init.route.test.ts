// Tests for POST /api/pair-init
// @vitest-environment node — route uses Node.js crypto + noble-ed25519

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TEST_PUBKEY_HEX, signMessage } from "./_fixtures";

// ── Module mocks ────────────────────────────────────────────────────────────

const mockMarkSeen = vi.fn(() => ({ ok: true }) as const);
vi.mock("@/lib/pairing/nonce-cache", () => ({
  nonceCache: {
    markSeen: mockMarkSeen,
  },
}));

// Mock admin client — INSERT to pending_pairings
const mockInsertSingle = vi.fn().mockResolvedValue({ data: null, error: null });
const mockInsert = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnValue({ single: mockInsertSingle }),
});
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });
const mockAdminClientInstance = { from: mockFrom };
vi.mock("@/lib/pairing/server", () => ({
  getSupabaseAdminClient: vi.fn(() => mockAdminClientInstance),
}));

// Mock rate limiter — succeeds by default
const mockPairInitLimit = vi.fn().mockResolvedValue({ success: true });
vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: vi.fn().mockReturnValue({}) },
}));
vi.mock("@upstash/ratelimit", () => {
  const sw = vi.fn(() => "sw");
  const RL = vi.fn().mockImplementation(() => ({ limit: mockPairInitLimit }));
  (RL as unknown as { slidingWindow: typeof sw }).slidingWindow = sw;
  return { Ratelimit: RL };
});

// ── Setup / teardown ────────────────────────────────────────────────────────

const VALID_GPU = "RX 6600 (Vulkan)";
const VALID_ENGINE_VERSION = "0.2.0";
const VALID_CODE = "ABCD-1234";

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
  vi.resetModules();
  mockMarkSeen.mockClear();
  mockMarkSeen.mockReturnValue({ ok: true } as const);
  mockPairInitLimit.mockResolvedValue({ success: true });
  mockInsertSingle.mockResolvedValue({ data: null, error: null });
  mockInsert.mockReturnValue({
    select: vi.fn().mockReturnValue({ single: mockInsertSingle }),
  });
  mockFrom.mockReturnValue({ insert: mockInsert });
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function makeValidBody(overrides: Record<string, unknown> = {}) {
  const nonce = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const issued_at = Date.now();
  const gpu = VALID_GPU;
  const engine_version = VALID_ENGINE_VERSION;
  const code = VALID_CODE;
  // B-02 message template: pair-init:{code}:{nonce}:{issued_at}:{gpu}:{engine_version}
  const message = `pair-init:${code}:${nonce}:${issued_at}:${gpu}:${engine_version}`;
  const signature = await signMessage(message);
  return {
    code,
    pubkey: TEST_PUBKEY_HEX,
    signature,
    nonce,
    issued_at,
    gpu,
    engine_version,
    ...overrides,
  };
}

async function makeValidRequest(overrides: Record<string, unknown> = {}) {
  const body = await makeValidBody(overrides);
  return new Request("https://vercel.app/api/pair-init", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "cf-connecting-ip": "1.2.3.4",
    },
    body: JSON.stringify(body),
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/pair-init", () => {
  it("returns 200 on valid request with gpu + engine_version round-tripping to INSERT (B-02)", async () => {
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    expect(res.status).toBe(200);

    // B-02: verify that gpu + engine_version are passed to the INSERT
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        gpu: VALID_GPU,
        engine_version: VALID_ENGINE_VERSION,
      }),
    );
  });

  it("returns 400 when gpu is missing", async () => {
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest({ gpu: undefined });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error", "bad_request");
  });

  it("returns 400 when engine_version is missing", async () => {
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest({ engine_version: undefined });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error", "bad_request");
  });

  it("returns 400 when engine_version is non-semver (e.g. 'v0.2')", async () => {
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest({ engine_version: "v0.2" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error", "bad_request");
  });

  it("returns 400 when pubkey format is invalid", async () => {
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest({ pubkey: "notvalidhex" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error", "bad_request");
  });

  it("returns 400 when signature format is invalid", async () => {
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest({ signature: "short" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error", "bad_request");
  });

  it("returns 400 when pairing code format is invalid", async () => {
    const { POST } = await import("@/app/api/pair-init/route");
    // Invalid code — lowercase not allowed per code.ts
    const req = await makeValidRequest({ code: "abcd-1234" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error", "bad_request");
  });

  it("returns 401 when nonce replay detected (markSeen reason=replay)", async () => {
    mockMarkSeen.mockReturnValueOnce({ ok: false, reason: "replay" } as const);
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error", "invalid_nonce");
  });

  it("returns 401 when issued_at is skewed (markSeen reason=skewed)", async () => {
    mockMarkSeen.mockReturnValueOnce({ ok: false, reason: "skewed" } as const);
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error", "invalid_nonce");
  });

  it("invalid sig does NOT advance nonce into markSeen — markSeen not called on bad sig (WR-06)", async () => {
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest({ signature: "0".repeat(128) });
    const res = await POST(req);
    expect(res.status).toBe(401);
    // Signature failed before markSeen — nonce must NOT have been recorded
    expect(mockMarkSeen).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body).toHaveProperty("error", "invalid_nonce");
  });

  it("returns 409 on primary key conflict (code_conflict)", async () => {
    mockInsertSingle.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toHaveProperty("error", "code_conflict");
  });

  it("returns 429 when rate limited", async () => {
    mockPairInitLimit.mockResolvedValueOnce({ success: false });
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toHaveProperty("error", "rate_limited");
  });

  it("returns 500 on unexpected DB error without leaking details", async () => {
    mockInsertSingle.mockRejectedValueOnce(
      new Error("connection refused with secret_db_password"),
    );
    const { POST } = await import("@/app/api/pair-init/route");
    const req = await makeValidRequest();
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty("error", "internal");
    expect(JSON.stringify(body)).not.toContain("connection refused");
    expect(JSON.stringify(body)).not.toContain("secret_db_password");
  });
});
