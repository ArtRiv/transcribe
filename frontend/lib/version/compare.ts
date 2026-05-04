// frontend/lib/version/compare.ts
//
// Engine version gate (VERSION-02 / VERSION-03 / D-20).
//
// We delegate every comparison to npm `semver` because hand-rolled
// split-and-parseInt fails on prerelease ordering: e.g. semver §11 says
// `0.2.0-rc.10 > 0.2.0-rc.2` (numeric identifiers compare numerically),
// and `0.2.0-rc.1 < 0.2.0` (prerelease has lower precedence than the
// non-prerelease). The naive parser gets both wrong; the test pack
// (compare.test.ts) explicitly pins these cases.
//
// Defensive contract:
//   - Returns false (never throws) on malformed input.
//   - Returns false if NEXT_PUBLIC_MIN_ENGINE_VERSION is unset/empty —
//     this surfaces an "outdated" prompt instead of crashing the page,
//     and makes a forgotten Vercel env var loud rather than silent.

import semver from "semver";

import { env } from "@/lib/env";

/**
 * True iff `engineVersion >= NEXT_PUBLIC_MIN_ENGINE_VERSION`.
 *
 * Returns false when either side is malformed semver, the engine is
 * older than the minimum, or the minimum env var is unset.
 */
export function isEngineCurrent(engineVersion: string): boolean {
  const min = env.NEXT_PUBLIC_MIN_ENGINE_VERSION;
  if (!min || !semver.valid(min)) return false;
  if (!semver.valid(engineVersion)) return false;
  return semver.gte(engineVersion, min);
}

/**
 * Wraps `semver.compare`. Used by tests + future plans that need to log
 * "engine downgraded since last seen".
 *
 * Throws on malformed inputs — the caller is expected to validate first
 * (this is a typed convenience over `semver.compare`, not a defensive
 * boundary).
 */
export function compareEngineVersions(a: string, b: string): -1 | 0 | 1 {
  return semver.compare(a, b) as -1 | 0 | 1;
}
