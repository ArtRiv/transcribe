// Unit tests for frontend/lib/auth/actions.ts (Plan 04-05 Task 1).
// Tests: signInWithMagicLink, signOut — Server Actions.
// Mocks: @/lib/supabase/server, next/headers, next/navigation.

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks ---

// Mock next/navigation (redirect is called by signOut)
vi.mock("next/navigation", () => ({
  redirect: vi.fn().mockImplementation((path: string) => {
    // Simulate redirect throwing (Next.js redirect() throws NEXT_REDIRECT internally).
    // We just throw a simple Error with the path for test assertion.
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

// Mock next/headers
const mockHeadersGet = vi.fn();
vi.mock("next/headers", () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: mockHeadersGet,
    }),
  ),
}));

// Mock supabase server client
const mockSignInWithOtp = vi.fn();
const mockSignOut = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signInWithOtp: mockSignInWithOtp,
        signOut: mockSignOut,
      },
    }),
  ),
}));

// Import AFTER mocks are registered.
import { signInWithMagicLink, signOut } from "@/lib/auth/actions";

describe("signInWithMagicLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: headers return a plausible origin.
    mockHeadersGet.mockImplementation((key: string) => {
      if (key === "origin") return "https://transcribe.vercel.app";
      if (key === "host") return "transcribe.vercel.app";
      return null;
    });
    mockSignInWithOtp.mockResolvedValue({ error: null });
  });

  it("calls supabase.auth.signInWithOtp with emailRedirectTo using origin", async () => {
    const fd = new FormData();
    fd.append("email", "user@example.com");

    const result = await signInWithMagicLink(fd);

    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: "user@example.com",
      options: expect.objectContaining({
        emailRedirectTo: "https://transcribe.vercel.app/auth/callback",
        shouldCreateUser: true,
      }),
    });
    expect(result).toEqual({ ok: true });
  });

  it("returns {ok: false, error: 'Email required'} when email is empty", async () => {
    const fd = new FormData();
    fd.append("email", "");

    const result = await signInWithMagicLink(fd);

    expect(result).toEqual({ ok: false, error: "Email required" });
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("returns {ok: false, error: 'Email required'} when email is whitespace only", async () => {
    const fd = new FormData();
    fd.append("email", "   ");

    const result = await signInWithMagicLink(fd);

    expect(result).toEqual({ ok: false, error: "Email required" });
  });

  it("returns {ok: false, error: <message>} when Supabase returns an error", async () => {
    mockSignInWithOtp.mockResolvedValue({
      error: { message: "Rate limit exceeded" },
    });
    const fd = new FormData();
    fd.append("email", "user@example.com");

    const result = await signInWithMagicLink(fd);

    expect(result).toEqual({ ok: false, error: "Rate limit exceeded" });
  });

  it("constructs origin from host header when origin header is absent", async () => {
    mockHeadersGet.mockImplementation((key: string) => {
      if (key === "origin") return null;
      if (key === "host") return "app.vercel.app";
      return null;
    });
    const fd = new FormData();
    fd.append("email", "user@example.com");

    await signInWithMagicLink(fd);

    expect(mockSignInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          emailRedirectTo: "https://app.vercel.app/auth/callback",
        }),
      }),
    );
  });
});

describe("signOut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("calls supabase.auth.signOut and then redirect('/')", async () => {
    const { redirect } = await import("next/navigation");
    try {
      await signOut();
    } catch (e) {
      // Expected — redirect() throws NEXT_REDIRECT in our mock.
    }
    expect(mockSignOut).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledWith("/");
  });
});
