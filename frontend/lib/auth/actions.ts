"use server";
// Server Actions for Supabase auth flows (Plan 04-05).
// [Cited: 04-RESEARCH.md §Pattern 4 lines 442-495; 04-PATTERNS.md "actions.ts" row]
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/** Result shape matching Phase 3's submit-result discriminated union. */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Sends a magic-link OTP email to the given address.
 * emailRedirectTo is derived from the request origin so this works across
 * Vercel preview domains and production (D-02).
 *
 * Anti-pattern avoided: NO getSession() — only getUser() / signInWithOtp.
 * [Cited: 04-PATTERNS.md §"Pitfall 5 — getSession()" + 04-RESEARCH.md §Security Domain V13]
 */
export async function signInWithMagicLink(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: false, error: "Email required" };

  const supabase = await getSupabaseServerClient();
  const headerStore = await headers();
  const origin =
    headerStore.get("origin") ??
    (headerStore.get("host") ? `https://${headerStore.get("host")}` : "");
  if (!origin) return { ok: false, error: "Cannot resolve origin" };

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      shouldCreateUser: true,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Signs the current user out and redirects to the homepage.
 * Returns `never` because redirect() throws a special NEXT_REDIRECT internally.
 * [Cited: 04-RESEARCH.md §Pattern 4 lines 472-480]
 */
export async function signOut(): Promise<never> {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/");
}
