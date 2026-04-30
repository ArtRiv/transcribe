// SOURCE: 04-RESEARCH.md §Pattern 1; 04-PATTERNS.md "client.ts" pattern.
// Browser-side Supabase client. Cached singleton — same instance for auth + Realtime.
"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let cached: SupabaseClient | null = null;

/** Lazy-initialised browser client. Used by:
 *  - frontend/lib/auth/anonymous.ts (Plan 04-05 ensureAnonymousSession)
 *  - frontend/lib/supabase/realtime-client.ts (subscribeToJob)
 *  - any "use client" surface that needs auth state.
 *  [Cited: 04-RESEARCH.md §Pattern 1 lines 320-340] */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (cached) return cached;
  cached = createBrowserClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  return cached;
}

/** Test-only reset hook. Vitest uses this to reset the singleton between tests.
 *  DO NOT call from production code. */
export function __resetBrowserClientForTest(): void {
  cached = null;
}
