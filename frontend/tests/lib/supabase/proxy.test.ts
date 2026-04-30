import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
  },
}));

// Mock next/server so NextResponse.next() doesn't require a real NextRequest object
// (Next.js 16 validates request.headers must be a Headers instance at runtime).
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    NextResponse: {
      ...actual.NextResponse,
      next: vi.fn(() => ({
        cookies: { set: vi.fn() },
        headers: { set: vi.fn() },
      })),
    },
  };
});

let capturedCookies: any = null;
const getClaims = vi.fn(async () => ({ data: { claims: null } }));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url, _key, opts) => {
    capturedCookies = opts.cookies;
    return { auth: { getClaims } };
  }),
}));

describe("updateSession", () => {
  beforeEach(() => {
    capturedCookies = null;
    getClaims.mockClear();
  });

  it("calls supabase.auth.getClaims() (verified path)", async () => {
    const { updateSession } = await import("@/lib/supabase/proxy");
    const nreq = {
      cookies: { getAll: () => [{ name: "sb-test", value: "abc" }] },
    } as any;
    await updateSession(nreq);
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it("getAll() reads from request.cookies.getAll()", async () => {
    const { updateSession } = await import("@/lib/supabase/proxy");
    const cookies = [{ name: "sb-test", value: "xyz" }];
    const nreq = { cookies: { getAll: () => cookies } } as any;
    await updateSession(nreq);
    expect(capturedCookies.getAll()).toEqual(cookies);
  });
});

describe("proxy.ts root file", () => {
  it("exports proxy and config with matcher", async () => {
    const mod = await import("@/proxy");
    expect(typeof mod.proxy).toBe("function");
    expect(mod.config).toBeDefined();
    expect(Array.isArray(mod.config.matcher)).toBe(true);
    expect(mod.config.matcher[0]).toContain("_next/static");
    expect(mod.config.matcher[0]).toContain("favicon.ico");
    expect(mod.config.matcher[0]).toContain("api");
  });
});
