// GET /api/signal-token/nonce
// Issues a single-use 32-byte challenge nonce for the Ed25519 signal-token flow.
// Rate-limited to 60 req/min/IP (engines reconnect frequently).
// No user auth required — nonces are meaningless without the private key.

import { NextResponse } from "next/server";
import { nonceCache } from "@/lib/pairing/nonce-cache";
import { signalTokenNonceLimiter, getClientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // 1. Rate limit by IP
    const key = getClientKey(request, "unknown");
    const { success } = await signalTokenNonceLimiter.limit(key);
    if (!success) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    // 2. Issue nonce
    const result = nonceCache.issue();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[signal-token/nonce] handler error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
