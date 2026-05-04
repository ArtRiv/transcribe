// Tests for frontend/lib/version/compare.ts — semver-backed engine version gate.
//
// VERSION-02 / VERSION-03: the frontend rejects engines below
// NEXT_PUBLIC_MIN_ENGINE_VERSION. Hand-rolled split-and-parseInt fails on
// prerelease ordering (e.g. rc.10 vs rc.2), which is the D-20 reason we
// delegate to npm `semver`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("isEngineCurrent", () => {
  let isEngineCurrent: typeof import("@/lib/version/compare").isEngineCurrent;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: { NEXT_PUBLIC_MIN_ENGINE_VERSION: "0.2.0" },
    }));
    ({ isEngineCurrent } = await import("@/lib/version/compare"));
  });

  afterEach(() => {
    vi.doUnmock("@/lib/env");
  });

  it("returns true when engineVersion equals the minimum", () => {
    expect(isEngineCurrent("0.2.0")).toBe(true);
  });

  it("returns true when engineVersion is higher (patch)", () => {
    expect(isEngineCurrent("0.2.1")).toBe(true);
  });

  it("returns true when engineVersion is higher (minor)", () => {
    expect(isEngineCurrent("0.3.0")).toBe(true);
  });

  it("returns false when engineVersion is lower (patch)", () => {
    expect(isEngineCurrent("0.1.99")).toBe(false);
  });

  it("returns false for malformed engineVersion (no throw)", () => {
    expect(isEngineCurrent("not-a-version")).toBe(false);
  });

  it("returns false for empty engineVersion", () => {
    expect(isEngineCurrent("")).toBe(false);
  });

  it("orders 0.2.0-rc.1 below 0.2.0 (prerelease)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: { NEXT_PUBLIC_MIN_ENGINE_VERSION: "0.2.0" },
    }));
    const { isEngineCurrent: f } = await import("@/lib/version/compare");
    expect(f("0.2.0-rc.1")).toBe(false);
  });

  it("orders 0.2.0-rc.10 above 0.2.0-rc.2 (semver §11 numeric prerelease)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: { NEXT_PUBLIC_MIN_ENGINE_VERSION: "0.2.0-rc.2" },
    }));
    const { isEngineCurrent: f } = await import("@/lib/version/compare");
    expect(f("0.2.0-rc.10")).toBe(true);
  });
});

describe("isEngineCurrent — missing env (defensive)", () => {
  it("returns false (and does not throw) when min version env is empty", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: { NEXT_PUBLIC_MIN_ENGINE_VERSION: "" },
    }));
    const { isEngineCurrent } = await import("@/lib/version/compare");
    expect(isEngineCurrent("1.0.0")).toBe(false);
  });
});

describe("compareEngineVersions", () => {
  let compareEngineVersions: typeof import("@/lib/version/compare").compareEngineVersions;

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({
      env: { NEXT_PUBLIC_MIN_ENGINE_VERSION: "0.2.0" },
    }));
    ({ compareEngineVersions } = await import("@/lib/version/compare"));
  });

  it("returns 0 for identical versions", () => {
    expect(compareEngineVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns -1 when a < b", () => {
    expect(compareEngineVersions("1.2.3", "1.2.4")).toBe(-1);
  });

  it("returns 1 when a > b", () => {
    expect(compareEngineVersions("1.2.4", "1.2.3")).toBe(1);
  });
});
