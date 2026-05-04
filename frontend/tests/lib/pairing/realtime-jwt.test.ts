// Tests for frontend/lib/pairing/realtime-jwt.ts
// Verifies: HS256 JWT sign + verify round-trip with correct claims.
// @vitest-environment node — jose requires real Node.js Uint8Array (not jsdom polyfill).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { jwtVerify } from "jose";
import { createSecretKey } from "crypto";

// We'll set SUPABASE_REALTIME_JWT_SECRET before importing the module under test.
// gitleaks-suppress: test-only non-secret placeholder value
const REALTIME_TEST_SECRET =
  "not-a-real-secret-32-chars-min-for-hs256-tests-only";

beforeEach(() => {
  process.env.SUPABASE_REALTIME_JWT_SECRET = REALTIME_TEST_SECRET;
});

afterEach(() => {
  delete process.env.SUPABASE_REALTIME_JWT_SECRET;
  vi.resetModules();
});

describe("signRealtimeJwt", () => {
  it("produces an HS256 JWT that can be verified with the same secret", async () => {
    // Dynamic import so env var is set before module-level code runs
    const { signRealtimeJwt } = await import("@/lib/pairing/realtime-jwt");

    const user_id = "550e8400-e29b-41d4-a716-446655440000";
    const channel = `pair:${user_id}`;
    const exp = Math.floor(Date.now() / 1000) + 300;

    const token = await signRealtimeJwt({ user_id, channel, exp });
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3); // header.payload.sig

    // Verify the token with jose
    const secretKey = createSecretKey(
      new TextEncoder().encode(REALTIME_TEST_SECRET),
    );
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });

    expect(payload.sub).toBe(`engine:${user_id}`);
    expect(payload.role).toBe("authenticated");
    expect(payload.user_id).toBe(user_id);
    expect(Array.isArray(payload.realtime_channels)).toBe(true);
    expect(payload.realtime_channels as string[]).toContain(channel);
    expect(payload.exp).toBe(exp);
  });

  it("rejects tokens signed with a different secret", async () => {
    const { signRealtimeJwt } = await import("@/lib/pairing/realtime-jwt");

    const user_id = "test-user-id";
    const token = await signRealtimeJwt({
      user_id,
      channel: `pair:${user_id}`,
      exp: Math.floor(Date.now() / 1000) + 300,
    });

    const wrongKey = createSecretKey(
      new TextEncoder().encode(
        "wrong-placeholder-that-is-at-least-32-chars-ok",
      ),
    );
    await expect(
      jwtVerify(token, wrongKey, { algorithms: ["HS256"] }),
    ).rejects.toThrow();
  });

  it("throws if SUPABASE_REALTIME_JWT_SECRET is missing", async () => {
    delete process.env.SUPABASE_REALTIME_JWT_SECRET;
    vi.resetModules();
    const { signRealtimeJwt } = await import("@/lib/pairing/realtime-jwt");
    await expect(
      signRealtimeJwt({
        user_id: "u",
        channel: "pair:u",
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ).rejects.toThrow(/SUPABASE_REALTIME_JWT_SECRET/);
  });
});
