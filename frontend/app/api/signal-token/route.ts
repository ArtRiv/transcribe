// POST /api/signal-token
// Ed25519 challenge-response → Supabase Realtime channel JWT.
//
// Flow (RESEARCH.md §Pattern 4):
//   1. Rate-limit by pubkey (30/min)
//   2. Parse + validate body with zod
//   3. Check nonce skew window (5 min)
//   4. Consume nonce from cache (single-use)
//   5. Look up device by pubkey (service-role admin client)
//   6. Verify Ed25519 signature over "signal-token:<nonce>:<issued_at>"
//   7. Mint HS256 Realtime JWT scoped to pair:<user_id> channel
//   8. Return { token, channel, supabase_url }
//
// All errors return generic copy (ASVS V7 — no stack traces, no DB error strings).

import { NextResponse } from "next/server";
import { z } from "zod";
import { nonceCache } from "@/lib/pairing/nonce-cache";
import { getSupabaseAdminClient } from "@/lib/pairing/server";
import { signRealtimeJwt } from "@/lib/pairing/realtime-jwt";
import { verifyEd25519, hexToBytes } from "@/lib/pairing/ed25519";
import { signalTokenLimiter, getClientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

const NONCE_TTL_MS = 5 * 60 * 1000;

const BodySchema = z.object({
  pubkey: z.string().regex(/^[0-9a-fA-F]{64}$/, "pubkey must be 64 hex chars"),
  nonce: z.string().min(1),
  signature: z
    .string()
    .regex(/^[0-9a-fA-F]{128}$/, "signature must be 128 hex chars"),
  issued_at: z.number().int().positive(),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 1. Parse body
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const { pubkey, nonce, signature, issued_at } = parsed.data;

    // 2. Rate-limit by pubkey (engines retry by pubkey identity)
    const key = getClientKey(request, pubkey);
    const { success } = await signalTokenLimiter.limit(pubkey);
    void key; // key used for fallback logging only
    if (!success) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    // 3. Check nonce skew window
    if (Date.now() - issued_at > NONCE_TTL_MS) {
      return NextResponse.json({ error: "nonce_expired" }, { status: 401 });
    }

    // 4. Consume nonce (single-use — deletes on first call regardless of expiry)
    if (!nonceCache.consume(nonce)) {
      return NextResponse.json({ error: "invalid_nonce" }, { status: 401 });
    }

    // 5. Look up device by pubkey.
    //    pubkey column is BYTEA; Postgrest needs Postgres hex format ("\xAABB...")
    //    on the filter value or the .eq comparison silently misses every row.
    const admin = getSupabaseAdminClient();
    const { data: device, error: dbError } = await admin
      .from("devices")
      .select("user_id, pubkey")
      .eq("pubkey", `\\x${pubkey}`)
      .single();

    // PostgREST returns PGRST116 ("no rows returned") on .single() with no match.
    // That's "device_not_found" — the engine treats HTTP 404 as the unpaired signal
    // (PAIR-06 / UAT-F). Any other DB error is a real internal failure.
    if (!device) {
      if (!dbError || dbError.code === "PGRST116") {
        return NextResponse.json(
          { error: "device_not_found" },
          { status: 404 },
        );
      }
      console.error("[signal-token] DB lookup error:", dbError.code);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    // 6. Verify Ed25519 signature over "signal-token:<nonce>:<issued_at>"
    const message = new TextEncoder().encode(
      `signal-token:${nonce}:${issued_at}`,
    );
    const sigBytes = hexToBytes(signature);
    const pubkeyBytes = hexToBytes(pubkey);
    const valid = await verifyEd25519(message, sigBytes, pubkeyBytes);
    if (!valid) {
      return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }

    // 7. Mint Realtime JWT scoped to pair:<user_id>
    const user_id = device.user_id as string;
    const channel = `pair:${user_id}`;
    const exp = Math.floor(Date.now() / 1000) + 300; // 5 minutes
    const token = await signRealtimeJwt({ user_id, channel, exp });

    // 8. Return token + channel + supabase_url
    return NextResponse.json({
      token,
      channel,
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    });
  } catch (err) {
    console.error("[signal-token] handler error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
