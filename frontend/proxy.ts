// SOURCE: Next.js 16 file convention (proxy.md). Replaces middleware.ts.
// The codemod `npx @next/codemod@canary middleware-to-proxy .` does this rename.
// proxy.ts defaults to Node.js runtime — DO NOT set `runtime: 'edge'` (proxy.md:217).
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Standard Next.js exclusion list — assets and API routes bypass session refresh.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api|.*\\.png$).*)",
  ],
};
