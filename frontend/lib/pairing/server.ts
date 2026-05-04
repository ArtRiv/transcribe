// SERVER-ONLY. Never import from frontend/lib/, frontend/components/, or frontend/app/* outside frontend/app/api/.
// Provides the Supabase service-role admin client for server-side route handlers.
// Service-role key is read from process.env directly — NOT from lib/env.ts (which is
// a client-bundle-safe module). This is the sole owner of SUPABASE_SERVICE_ROLE_KEY.

// Defense-in-depth: throw immediately if this module is accidentally bundled into
// client-side code (Tree-shaking won't catch all import paths).
if (typeof window !== "undefined") {
  throw new Error("lib/pairing/server.ts loaded in browser");
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _adminClient: SupabaseClient | null = null;

/**
 * Returns a service-role-keyed Supabase client (lazy singleton).
 * Bypasses Row Level Security — use ONLY in server-side route handlers.
 * Throws at runtime if SUPABASE_SERVICE_ROLE_KEY is not set.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  if (_adminClient) return _adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  }
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
  }

  _adminClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return _adminClient;
}
