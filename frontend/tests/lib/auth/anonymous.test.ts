// Unit tests for frontend/lib/auth/anonymous.ts (Plan 04-05 Task 1).
// Tests: ensureAnonymousSession — browser-side idempotent sign-in bootstrap.
// Mocks: @/lib/supabase/client.

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks ---

const mockGetUser = vi.fn();
const mockSignInAnonymously = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
      signInAnonymously: mockSignInAnonymously,
    },
  })),
}));

import { ensureAnonymousSession } from "@/lib/auth/anonymous";

describe("ensureAnonymousSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing user.id when getUser returns a signed-in user", async () => {
    const userId = "existing-user-uuid-1234";
    mockGetUser.mockResolvedValue({
      data: { user: { id: userId } },
      error: null,
    });

    const result = await ensureAnonymousSession();

    expect(result).toBe(userId);
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it("calls signInAnonymously when no existing session, returns new user.id", async () => {
    const newUserId = "new-anon-user-uuid-5678";
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mockSignInAnonymously.mockResolvedValue({
      data: { user: { id: newUserId } },
      error: null,
    });

    const result = await ensureAnonymousSession();

    expect(mockSignInAnonymously).toHaveBeenCalledOnce();
    expect(result).toBe(newUserId);
  });

  it("throws when signInAnonymously returns an error", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mockSignInAnonymously.mockResolvedValue({
      data: { user: null },
      error: { message: "Anonymous sign-in disabled" },
    });

    await expect(ensureAnonymousSession()).rejects.toThrow(
      "Anonymous sign-in failed",
    );
  });

  it("throws when signInAnonymously returns no user (data.user is null)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mockSignInAnonymously.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    await expect(ensureAnonymousSession()).rejects.toThrow(
      "Anonymous sign-in failed",
    );
  });
});
