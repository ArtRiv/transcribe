// frontend/tests/smoke.test.ts
// Phase 1 smoke test — proves Vitest runs and the @/* alias resolves.
// Phase 3 (TEST-03) will add real tests for the export renderers.

import { describe, it, expect } from "vitest";
import { env, hasBackendUrl } from "@/lib/env";

describe("env reader", () => {
  it("exposes the three NEXT_PUBLIC_* keys as a readonly object", () => {
    expect(env).toHaveProperty("NEXT_PUBLIC_BACKEND_URL");
    expect(env).toHaveProperty("NEXT_PUBLIC_SUPABASE_URL");
    expect(env).toHaveProperty("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("each value is a string (defaults to empty when not set)", () => {
    expect(typeof env.NEXT_PUBLIC_BACKEND_URL).toBe("string");
    expect(typeof env.NEXT_PUBLIC_SUPABASE_URL).toBe("string");
    expect(typeof env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("string");
  });

  it("hasBackendUrl reflects whether the URL is non-empty", () => {
    expect(hasBackendUrl).toBe(env.NEXT_PUBLIC_BACKEND_URL.length > 0);
  });

  it("does NOT expose any server-only secrets (sanity check)", () => {
    // Importing env should NOT pull in service-role keys or HF tokens.
    // If a future regression adds them, this test catches it.
    const keys = Object.keys(env);
    for (const key of keys) {
      expect(key.startsWith("NEXT_PUBLIC_")).toBe(true);
    }
  });
});
