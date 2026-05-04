// frontend/lib/env.ts
// Type-safe accessor for NEXT_PUBLIC_* env vars.
//
// NEXT_PUBLIC_* values are inlined into the client JS bundle at build time
// (Vercel build, Next.js convention). Reading them via this module gives us
// a single point to validate presence and document each var's purpose.
//
// Server-only env vars (the Supabase service-role key, the HuggingFace token,
// and any other backend secrets) MUST NOT be read here — they would leak into
// the client bundle. Use a separate server-side module instead.

// Server-only env vars (CLOUDFLARE_CALLS_TURN_*, SUPABASE_REALTIME_JWT_SECRET,
// UPSTASH_REDIS_*) are read directly from process.env inside route handlers.

/**
 * Public env vars exposed to the browser.
 * Each is set at Vercel build time; tunnel URL changes require a redeploy.
 */
export const env = {
  /** Cloudflare Quick Tunnel URL pointing at the FastAPI backend. */
  NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL ?? "",
  /** Supabase project URL (https://<ref>.supabase.co). */
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  /** Supabase anon / publishable key (sb_publishable_* or legacy eyJ...). */
  NEXT_PUBLIC_SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  /** "1" enables MSW + mock Realtime in development; any other value disables. */
  NEXT_PUBLIC_USE_MOCKS: process.env.NEXT_PUBLIC_USE_MOCKS ?? "0",
  /**
   * Minimum engine semver version the frontend will accept.
   * Engines below this version receive an "Update available" prompt and cannot
   * start new jobs (VERSION-02). Default "0.2.0" is the Phase 8 artifact tag.
   * Override via Vercel env var when a breaking protocol change ships.
   */
  NEXT_PUBLIC_MIN_ENGINE_VERSION:
    process.env.NEXT_PUBLIC_MIN_ENGINE_VERSION ?? "0.2.0",
} as const;

export type PublicEnv = typeof env;

/**
 * True when at least the BACKEND URL is set. Phase 1 doesn't require Supabase
 * client wiring (Phase 4 does); this lets the placeholder page surface a
 * useful "configured?" state without crashing on missing values.
 */
export const hasBackendUrl = env.NEXT_PUBLIC_BACKEND_URL.length > 0;
