// POST /api/pair-init
// Engine pre-registration: validates Ed25519 challenge-response and inserts a
// pending_pairings row including gpu + engine_version (B-02).
//
// Flow:
//   1. Rate-limit by cf-connecting-ip (5/min — T-08-04b-01 / T-08-04b-04)
//   2. Parse + validate body with zod (B-02 schema including gpu + engine_version)
//   3. Validate pairing code format
//   4. Verify Ed25519 signature over "pair-init:{code}:{nonce}:{issued_at}:{gpu}:{engine_version}"
//      (sig BEFORE nonce — prevents attacker burning honest engine nonce with bad sig; WR-06)
//   5. consume(nonce) — single-use server-issued nonce (engine fetches from /api/signal-token/nonce)
//   6. INSERT into pending_pairings (code, pubkey, gpu, engine_version) via admin client
//   7. Return 200 on success
//
// All errors return generic copy (ASVS V7 — no stack traces, no DB error strings).
// [Cited: 08-05 decision: B-02 pair-init message template locked; T-08-04b-01 thru T-08-04b-04]

import { NextResponse } from "next/server";
import { z } from "zod";
import { nonceCache } from "@/lib/pairing/nonce-cache";
import { getSupabaseAdminClient } from "@/lib/pairing/server";
import { verifyEd25519, hexToBytes } from "@/lib/pairing/ed25519";
import { isValidPairingCode } from "@/lib/pairing/code";
import { pairInitLimiter, getClientKey } from "@/lib/rate-limit";

export const runtime = "nodejs";

// B-02: zod schema — gpu + engine_version are required alongside the core sig fields
const pairInitSchema = z.object({
  code: z.string(),
  pubkey: z.string().regex(/^[0-9a-f]{64}$/),
  signature: z.string().regex(/^[0-9a-f]{128}$/),
  nonce: z.string().min(32),
  issued_at: z.number().int().positive(),
  gpu: z.string().min(1).max(64),
  engine_version: z.string().regex(/^\d+\.\d+\.\d+(-.+)?$/),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 1. Rate-limit by IP (5/min — T-08-04b-04)
    const clientKey = getClientKey(request, "unknown");
    const { success } = await pairInitLimiter.limit(clientKey);
    if (!success) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    // 2. Parse + validate body
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    const parsed = pairInitSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const { code, pubkey, signature, nonce, issued_at, gpu, engine_version } =
      parsed.data;

    // 3. Validate pairing code format
    if (!isValidPairingCode(code)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    // 4. Verify Ed25519 signature BEFORE recording the nonce (WR-06: prevents
    //    attacker with a bad signature from burning the honest engine's nonce).
    // B-02 message template (locked in 08-05 decision): pair-init:{code}:{nonce}:{issued_at}:{gpu}:{engine_version}
    // Any drift between this template and Plan 05 pair_init.py will 401 every pair-init.
    const message = new TextEncoder().encode(
      `pair-init:${code}:${nonce}:${issued_at}:${gpu}:${engine_version}`,
    );
    const sigBytes = hexToBytes(signature);
    const pubkeyBytes = hexToBytes(pubkey);
    const valid = await verifyEd25519(message, sigBytes, pubkeyBytes);
    if (!valid) {
      return NextResponse.json({ error: "invalid_nonce" }, { status: 401 });
    }

    // 5. Consume server-issued nonce (single-use; engine fetched it from /api/signal-token/nonce).
    //    Returns false on unknown / expired / already-consumed — engine retries on 401.
    if (!nonceCache.consume(nonce)) {
      return NextResponse.json({ error: "invalid_nonce" }, { status: 401 });
    }

    // 6. INSERT into pending_pairings (B-02: includes gpu + engine_version).
    //    pubkey column is BYTEA; Postgrest expects Postgres hex format ("\xAABB..."),
    //    so prefix the engine-supplied hex string with "\x" on the way in.
    const admin = getSupabaseAdminClient();
    const { error: insertError } = await admin
      .from("pending_pairings")
      .insert({ code, pubkey: `\\x${pubkey}`, gpu, engine_version })
      .select()
      .single();

    if (insertError) {
      // PK conflict on code (cosmically unlikely but handle gracefully)
      if (insertError.code === "23505") {
        return NextResponse.json({ error: "code_conflict" }, { status: 409 });
      }
      console.error("[pair-init] DB insert error:", insertError.code);
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    // 7. Success
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[pair-init] handler error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
