// Auth callback error page — sibling of /auth/callback (which is a Route Handler).
// route.ts redirects here on success failure: /auth/callback/error?reason=invalid.
import { AuthCallbackStatus } from "@/components/transcribe/auth/auth-callback-status";

export default async function AuthCallbackErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const sp = await searchParams;
  return <AuthCallbackStatus error={sp.reason ?? "invalid"} />;
}
