/**
 * Unit tests for frontend/lib/auth/promote.ts — Task 2 TDD RED phase.
 *
 * [Cited: 04-08 PLAN §behavior; 04-PATTERNS.md "frontend/lib/auth/promote.ts" row]
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_BACKEND_URL: "http://localhost:8000",
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    NEXT_PUBLIC_USE_MOCKS: "0",
  },
}));

const mockGetSession = vi.fn();
const mockSupabaseClient = {
  auth: {
    getSession: mockGetSession,
  },
};

const mockFetch = vi.fn();

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  vi.resetAllMocks();

  const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
  (getSupabaseBrowserClient as ReturnType<typeof vi.fn>).mockReturnValue(
    mockSupabaseClient,
  );

  global.fetch = mockFetch;
});

afterEach(() => {
  vi.resetModules();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_ARGS = {
  jobId: "job-abc-123",
  previousAnonToken: "anon-jwt-token",
  payload: { segments: [], speakers: [] },
  title: "Test Transcript",
  source_filename: "test.wav",
  duration_sec: 30,
  language: "en" as const,
  model_used: "small",
  diarized: false,
};

function mockSession(token: string) {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: token } },
  });
}

function mockNoSession() {
  mockGetSession.mockResolvedValue({
    data: { session: null },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("promoteAnonJob", () => {
  it("returns {ok: false, error} when not signed in", async () => {
    mockNoSession();

    const { promoteAnonJob } = await import("@/lib/auth/promote");
    const result = await promoteAnonJob(BASE_ARGS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not signed in/i);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls fetch with correct URL including job ID", async () => {
    mockSession("signed-in-access-token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ transcript_id: "new-transcript-uuid" }),
    });

    const { promoteAnonJob } = await import("@/lib/auth/promote");
    await promoteAnonJob(BASE_ARGS);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0] as [string, ...unknown[]];
    expect(url).toContain("/jobs/job-abc-123/promote");
    expect(url).toContain("http://localhost:8000");
  });

  it("sends Authorization header with signed-in access_token", async () => {
    mockSession("my-signed-in-jwt");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ transcript_id: "new-transcript-uuid" }),
    });

    const { promoteAnonJob } = await import("@/lib/auth/promote");
    await promoteAnonJob(BASE_ARGS);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer my-signed-in-jwt");
  });

  it("sends X-Previous-Anon-Token header", async () => {
    mockSession("signed-in-token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ transcript_id: "new-transcript-uuid" }),
    });

    const { promoteAnonJob } = await import("@/lib/auth/promote");
    await promoteAnonJob({ ...BASE_ARGS, previousAnonToken: "the-anon-jwt" });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Previous-Anon-Token"]).toBe("the-anon-jwt");
  });

  it("returns {ok: true, transcriptId} on 201 success", async () => {
    mockSession("signed-in-token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ transcript_id: "returned-uuid" }),
    });

    const { promoteAnonJob } = await import("@/lib/auth/promote");
    const result = await promoteAnonJob(BASE_ARGS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transcriptId).toBe("returned-uuid");
    }
  });

  it("returns {ok: false, error} on non-2xx response", async () => {
    mockSession("signed-in-token");
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "Not the original anonymous owner of this job",
    });

    const { promoteAnonJob } = await import("@/lib/auth/promote");
    const result = await promoteAnonJob(BASE_ARGS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/403/);
    }
  });

  it("returns {ok: false, error} on network error", async () => {
    mockSession("signed-in-token");
    mockFetch.mockRejectedValue(new Error("Network failure"));

    const { promoteAnonJob } = await import("@/lib/auth/promote");
    const result = await promoteAnonJob(BASE_ARGS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/network failure/i);
    }
  });

  it("uses POST method", async () => {
    mockSession("signed-in-token");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ transcript_id: "uuid" }),
    });

    const { promoteAnonJob } = await import("@/lib/auth/promote");
    await promoteAnonJob(BASE_ARGS);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
  });
});
