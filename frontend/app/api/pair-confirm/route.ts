// POST /api/pair-confirm
// Signed-in user confirms pairing by calling the SECURITY DEFINER RPC.
//
// B-03 INVARIANT: This route calls ONLY the `pair_confirm_atomic` RPC.
// There is NO two-statement fallback path. All delete-then-insert atomicity
// lives inside the Postgres RPC per D-04. If the RPC errors, we 500 and stop.
//
// Flow:
//   1. Parse + validate body with zod
//   2. Auth-check via Supabase cookie session
//   3. Rate-limit by user_id (10/min — D-21: keyed on authenticated user, not IP)
//   4. Validate pairing code format
//   5. Call pair_confirm_atomic(_code, _user=auth.uid(), _replace) via admin client
//   6. Map RPC response to HTTP status
//
// All errors return generic copy (ASVS V7 — no stack traces, no DB error strings).
// [Cited: B-03; D-04; T-08-04b-03; T-08-04b-05]

import { NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/pairing/server";
import { isValidPairingCode } from "@/lib/pairing/code";
import { pairConfirmLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

const pairConfirmSchema = z.object({
  code: z.string(),
  replace: z.boolean().optional(),
});

/** Shape of a single row returned from pair_confirm_atomic. */
interface PairConfirmResult {
  success: boolean;
  conflict: boolean;
  existing_name: string | null;
  existing_gpu: string | null;
  existing_seen: string | null;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // 1. Parse + validate body
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    const parsed = pairConfirmSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const { code, replace } = parsed.data;

    // 2. Auth-check — user_id comes from the verified cookie session, NEVER from body
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    // 3. Rate-limit by user_id (D-21: keyed on authenticated user, not IP)
    const { success: allowed } = await pairConfirmLimiter.limit(
      `user:${user.id}`,
    );
    if (!allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    // 4. Validate pairing code format
    if (!isValidPairingCode(code)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }

    // 5. Call pair_confirm_atomic RPC — B-03: this is the ONLY call; no fallback path
    const admin = getSupabaseAdminClient();
    const { data, error: rpcError } = await admin.rpc("pair_confirm_atomic", {
      _code: code,
      _user: user.id, // T-08-04b-03: user_id from auth, never from request body
      _replace: replace ?? false,
    });

    if (rpcError) {
      console.error("[pair-confirm] RPC error:", rpcError.code ?? "unknown");
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    // 6. Map RPC response shape to HTTP status
    // WR-05: guard against empty/non-array before indexing
    if (!Array.isArray(data) || data.length === 0) {
      console.error("[pair-confirm] RPC returned no rows");
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }
    const row = data[0] as PairConfirmResult;

    if (row.success) {
      return NextResponse.json({ ok: true });
    }

    if (row.conflict) {
      // Device conflict — drive the D-04 "Replace this engine?" UI flow
      return NextResponse.json(
        {
          error: "device_conflict",
          existing: {
            name: row.existing_name,
            gpu: row.existing_gpu,
            last_seen: row.existing_seen,
          },
        },
        { status: 409 },
      );
    }

    // success=false, conflict=false → pending row missing or expired
    return NextResponse.json({ error: "expired_or_unknown" }, { status: 410 });
  } catch (err) {
    console.error("[pair-confirm] handler error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
