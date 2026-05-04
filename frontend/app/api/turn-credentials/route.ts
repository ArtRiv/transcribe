// GET /api/turn-credentials
// Returns Cloudflare Calls-issued ICE servers with 1-hour TTL (D-18).
//
// Flow:
//   1. Auth-check via Supabase cookie session
//   2. Rate-limit by user_id (60/min — D-21: keyed on authenticated user, not IP)
//   3. Call Cloudflare Calls credentials API with server-side API token
//   4. Return { iceServers }
//
// The CLOUDFLARE_CALLS_TURN_API_TOKEN never reaches the browser (T-08-04b-06).
// All errors return generic copy (ASVS V7 — no stack traces).
// [Cited: 08-RESEARCH.md §Cloudflare Calls TURN credentials; D-18; T-08-04b-06]

import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { turnCredentialsLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

// D-18: named constant so TTL stays in lockstep between the Cloudflare request body
// and any future Cache-Control header (e.g. max-age=${TURN_CRED_TTL_SECONDS - 60}).
const TURN_CRED_TTL_SECONDS = 3600; // 1 hour

export async function GET(): Promise<NextResponse> {
  try {
    // 1. Auth-check
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    // 2. Rate-limit by user_id (D-21: keyed on authenticated user, not IP)
    const { success: allowed } = await turnCredentialsLimiter.limit(
      `user:${user.id}`,
    );
    if (!allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    // 3. Call Cloudflare Calls credentials API
    const keyId = process.env.CLOUDFLARE_CALLS_TURN_KEY_ID;
    const apiToken = process.env.CLOUDFLARE_CALLS_TURN_API_TOKEN;

    if (!keyId || !apiToken) {
      console.error(
        "[turn-credentials] missing CLOUDFLARE_CALLS_TURN_KEY_ID or CLOUDFLARE_CALLS_TURN_API_TOKEN",
      );
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    const cfRes = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_CRED_TTL_SECONDS }), // D-18
      },
    );

    if (!cfRes.ok) {
      console.error(
        `[turn-credentials] Cloudflare API returned ${cfRes.status}`,
      );
      return NextResponse.json({ error: "turn_unavailable" }, { status: 502 });
    }

    const { iceServers } = (await cfRes.json()) as { iceServers: unknown[] };

    // 4. Return ICE servers (API token never included in response)
    return NextResponse.json({ iceServers });
  } catch (err) {
    console.error("[turn-credentials] handler error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
