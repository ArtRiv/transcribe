import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock next/headers BEFORE importing the module under test.
const cookieStore = {
  getAll: vi.fn(() => [{ name: "sb-test", value: "abc" }]),
  set: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
  },
}));

// Capture cookie methods passed to createServerClient.
let capturedCookies: any = null;
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url, _key, opts) => {
    capturedCookies = opts.cookies;
    return { __mock: true };
  }),
}));

describe("getSupabaseServerClient", () => {
  beforeEach(() => {
    cookieStore.getAll.mockClear();
    cookieStore.set.mockClear();
    capturedCookies = null;
  });

  it("awaits cookies() (async API)", async () => {
    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    await getSupabaseServerClient();
    expect(capturedCookies).not.toBeNull();
  });

  it("getAll() returns cookieStore.getAll() passthrough", async () => {
    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    await getSupabaseServerClient();
    const result = capturedCookies.getAll();
    expect(cookieStore.getAll).toHaveBeenCalled();
    expect(result).toEqual([{ name: "sb-test", value: "abc" }]);
  });

  it("setAll wraps cookieStore.set in try/catch (Pitfall 3)", async () => {
    cookieStore.set.mockImplementation(() => {
      throw new Error("RSC: cannot set cookies");
    });
    const { getSupabaseServerClient } = await import("@/lib/supabase/server");
    await getSupabaseServerClient();
    expect(() =>
      capturedCookies.setAll([{ name: "sb-test", value: "x", options: {} }]),
    ).not.toThrow();
  });
});
