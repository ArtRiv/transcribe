// HS256 Realtime JWT signer for the signal-token route.
// Mints a short-lived JWT scoped to a single Supabase Realtime channel.
// SUPABASE_REALTIME_JWT_SECRET is the sole owner of this module's signing key.
//
// Uses `jose` (Edge-runtime safe, lighter than jsonwebtoken).
// jose@^5 must be installed: pnpm add jose@^5

import { SignJWT } from "jose";

/**
 * Sign a Supabase Realtime channel JWT (HS256).
 *
 * Claims follow Supabase's custom JWT model for Realtime:
 *   sub: "engine:<user_id>"
 *   role: "authenticated"
 *   user_id: "<uuid>"
 *   realtime_channels: ["pair:<user_id>"]
 *   exp: <unix_seconds>
 */
export async function signRealtimeJwt({
  user_id,
  channel,
  exp,
}: {
  user_id: string;
  channel: string;
  exp: number;
}): Promise<string> {
  const secret = process.env.SUPABASE_REALTIME_JWT_SECRET;
  if (!secret) {
    throw new Error("SUPABASE_REALTIME_JWT_SECRET missing");
  }

  // jose@5 accepts Uint8Array directly for HMAC keys
  const key = new TextEncoder().encode(secret);

  return new SignJWT({
    role: "authenticated",
    user_id,
    realtime_channels: [channel],
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`engine:${user_id}`)
    .setExpirationTime(exp)
    .setIssuedAt()
    .sign(key);
}
