// POST /api/unpair
// Signed-in user deletes their paired device row (user-initiated unpair).
//
// Flow:
//   1. Auth-check via Supabase cookie session
//   2. Rate-limit by user_id (10/min — D-21; unpairLimiter is independent of pair-confirm)
//   3. DELETE FROM devices WHERE user_id = auth.uid() via admin client
//   4. Return 200 on success
//
// No body expected. user_id comes exclusively from the verified session (T-08-04b-03).
// Unpair is logged at Vercel-logs level (route name + user_id) but not persisted (T-08-04b-07).
// All errors return generic copy (ASVS V7 — no stack traces, no DB error strings).
// [Cited: T-08-04b-07 accept disposition (privacy-first v1 ethos)]

import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/pairing/server";
import { unpairLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(_request: Request): Promise<NextResponse> {
  try {
    // 1. Auth-check — user_id from verified session only
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }

    // 2. Rate-limit by user_id (D-21: own budget, independent of pair-confirm)
    const { success: allowed } = await unpairLimiter.limit(`user:${user.id}`);
    if (!allowed) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }

    // T-08-04b-07: log user-initiated unpair at server level (not persisted).
    // console.error is intentional — ensures capture on Vercel free/hobby tier where
    // console.log may not be durably flushed.
    console.error(`[unpair] user=${user.id}`);

    // 3. DELETE device row — user_id from auth (never from body)
    const admin = getSupabaseAdminClient();
    const { error: deleteError } = await admin
      .from("devices")
      .delete()
      .eq("user_id", user.id);

    if (deleteError) {
      console.error("[unpair] DB delete error:", deleteError.code ?? "unknown");
      return NextResponse.json({ error: "internal" }, { status: 500 });
    }

    // 4. Success (idempotent — no device row to delete is still 200)
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[unpair] handler error:", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
