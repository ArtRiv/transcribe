// SOURCE: 04-RESEARCH.md §Pattern 3 lines 384-440; 04-PATTERNS.md "proxy.ts" pattern.
// Cookie-driven session refresh helper. Called from the root frontend/proxy.ts.
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/** Refresh the Supabase session cookies for an incoming request.
 *  Returns a NextResponse with refreshed Set-Cookie headers; the caller
 *  (proxy.ts) returns this response (or rewrites it before returning).
 *  [Cited: createServerClient.d.ts lines 26-30 — "Failing to implement
 *   getAll and setAll correctly will cause significant and difficult to
 *   debug authentication issues."] */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          // Propagate cache-control headers from @supabase/ssr to prevent
          // CDN cross-tenant session leak. [Cited: types.d.ts lines 27-31]
          if (headers) {
            Object.entries(headers).forEach(([k, v]) => {
              response.headers.set(k, v as string);
            });
          }
        },
      },
    },
  );

  // VERIFIED path — getClaims() validates JWT signature via JWKS.
  // NEVER use getSession() for authorization (Pitfall 5).
  await supabase.auth.getClaims();

  return response;
}
