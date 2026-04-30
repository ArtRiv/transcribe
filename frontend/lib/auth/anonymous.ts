"use client";
// Browser-side anonymous sign-in bootstrap (Plan 04-05).
// Idempotent: returns the existing user.id if already signed in.
// [Cited: 04-RESEARCH.md §Pattern 5 lines 497-517; 04-PATTERNS.md "anonymous.ts" row]
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Ensures the browser has an active Supabase session (anonymous or signed-in).
 * Returns the user.id (== jobs.user_id under RLS).
 *
 * Call this from onSubmit in app/page.tsx BEFORE submitJob() — AUTH-01 lazy bootstrap.
 *
 * Anti-pattern avoided: NO getSession() — uses getUser() (round-trip-verified).
 * [Cited: 04-PATTERNS.md §"Pitfall 5 — getSession()"]
 */
export async function ensureAnonymousSession(): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(`Anonymous sign-in failed: ${error?.message ?? "unknown"}`);
  }
  return data.user.id;
}
