// Magic-link callback Route Handler (Plan 04-05).
// Exchanges ?code= for a session, sets cookies, redirects.
// Validates ?next= is a relative path — open-redirect mitigation (RESEARCH §Security Domain V13).
// [Cited: 04-PATTERNS.md "auth/callback/route.ts" row; T-04-04 threat mitigated here]
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextRaw = searchParams.get("next") ?? "/";

  // Open-redirect mitigation (RESEARCH §Security Domain V13, T-04-04):
  // Accept only relative paths that start with a single '/'.
  // '//foo.com' would be treated as a protocol-relative URL — reject it.
  const next =
    nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  if (code) {
    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  // Invalid code or missing — redirect to callback page with error indicator.
  return NextResponse.redirect(`${origin}/auth/callback?error=invalid`);
}
