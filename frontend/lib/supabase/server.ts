// SOURCE: 04-RESEARCH.md §Pattern 2; 04-PATTERNS.md "server.ts" pattern (lines 137-170).
// Used by Server Components, Server Actions, Route Handlers.
// Next.js 16: cookies() is ASYNC — `await cookies()` is mandatory.
import { cookies } from "next/headers";
import { createServerClient, type CookieMethodsServer } from "@supabase/ssr";
import { env } from "@/lib/env";

/** Returns a Supabase client cookie-bound to the current request.
 *  In RSC contexts, setAll silently no-ops (proxy.ts handles refresh).
 *  In Server Actions / Route Handlers, setAll writes cookies normally.
 *  [Cited: 04-RESEARCH.md §Pitfall 3] */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // RSC context — proxy.ts already refreshed the session.
            // Pitfall 3: silent no-op is the canonical pattern.
          }
        },
      } satisfies CookieMethodsServer,
    },
  );
}
