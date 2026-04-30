// Auth callback page — shown when the magic-link redirect lands here with
// ?error= (invalid/expired code). On success, route.ts redirects before page renders.
// [Cited: 04-PATTERNS.md "auth/callback/page.tsx" — RSC shell delegating to client island]
import { AuthCallbackStatus } from "@/components/transcribe/auth/auth-callback-status";

export default async function AuthCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  return <AuthCallbackStatus error={sp.error ?? null} />;
}
