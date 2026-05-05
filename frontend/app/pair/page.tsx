/**
 * /pair?code=… — RSC shell (08-08 Task 2).
 *
 * Reads ?code from searchParams (Next.js 16 async shape).
 * Validates, fetches pending_pairings + devices server-side, hands off to PairClient.
 *
 * Server-side trust decisions (T-08-08-01..04):
 *   - pending_pairings read via service-role admin client (read-only, no user-level bypass)
 *   - devices read via user RLS-scoped client (owner-only)
 *   - Only safe public fields are forwarded to the client (truncated pubkey, GPU, version)
 */
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isValidPairingCode } from "@/lib/pairing/code";
import { PairClient } from "./pair-client";
import type { PairFingerprint } from "@/components/transcribe/pair-card";

/** Truncate hex pubkey to first 16 chars + ellipsis (T-08-08-02). */
function truncatePubkey(hex: string): string {
  if (!hex || hex.length <= 16) return hex ?? "";
  return hex.slice(0, 16) + "…";
}

/** Build an expires-in string from created_at if available. */
function buildExpiresIn(createdAt: string | null): string | undefined {
  if (!createdAt) return undefined;
  try {
    const expiresAt = new Date(createdAt).getTime() + 10 * 60 * 1000; // 10 min TTL
    const now = Date.now();
    const remaining = Math.floor((expiresAt - now) / 60000);
    if (remaining <= 0) return undefined;
    return `(expires in ${remaining} min)`;
  } catch {
    return undefined;
  }
}

export default async function PairPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const sp = await searchParams;
  const code = sp.code ?? "";

  // Validate code format
  if (!code || !isValidPairingCode(code)) {
    return (
      <main
        style={{
          display: "flex",
          justifyContent: "center",
          paddingTop: "var(--sp-7)",
          paddingBottom: "var(--sp-8)",
          paddingLeft: "var(--sp-6)",
          paddingRight: "var(--sp-6)",
        }}
      >
        <PairClient
          code={code}
          fingerprint={{ device: "", gpu: "", engine: "", ed25519: "" }}
          initialKind="failure"
          failureReason="generic"
        />
      </main>
    );
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Signed-out: fetch pending_pairings for preview, then show sign-in panel (D-14)
  // Note: for the signed-out preview we still need the fingerprint.
  // We fetch using service-role for the pending_pairings read.
  // (The service-role key is read via server-side env, never exposed to client)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  let fingerprint: PairFingerprint = {
    device: "",
    gpu: "",
    engine: "",
    ed25519: "",
  };
  let expiresIn: string | undefined;
  let pairingRowExists = false;
  let isExpired = false;

  // Fetch pending_pairings row using service-role (bypasses RLS for this read)
  if (serviceRoleKey && supabaseUrl) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const adminClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
      });
      const { data: pairingRow } = await adminClient
        .from("pending_pairings")
        .select("pubkey, gpu, engine_version, created_at, expires_at")
        .eq("code", code)
        .maybeSingle();

      if (pairingRow) {
        pairingRowExists = true;

        // Check expiry
        if (pairingRow.expires_at && new Date(pairingRow.expires_at) < new Date()) {
          isExpired = true;
        }

        // B-02: GPU and engine_version MUST be real values from the row.
        // If either is missing, throw to surface the Plan 04b bug immediately.
        if (!pairingRow.gpu || !pairingRow.engine_version) {
          throw new Error(
            `B-02 violation: pending_pairings row for code ${code} has null gpu or engine_version. ` +
              `This is a bug in Plan 04b's pair-init route — the fingerprint must not be empty.`
          );
        }

        fingerprint = {
          device: "", // Phase 9 will plumb hostname; Phase 8 defers device-name
          gpu: pairingRow.gpu,
          engine: `v${pairingRow.engine_version}`,
          ed25519: truncatePubkey(
            Buffer.from(pairingRow.pubkey, "base64").toString("hex")
          ),
        };
        expiresIn = buildExpiresIn(pairingRow.created_at);
      }
    } catch (err) {
      // Re-throw B-02 violations; swallow other errors (network issues, etc.)
      if (err instanceof Error && err.message.startsWith("B-02")) throw err;
      console.error("[pair/page] Failed to fetch pending_pairings:", err);
    }
  }

  // Signed-out: show preview + inline sign-in panel (D-14)
  if (!user || user.is_anonymous) {
    return (
      <main
        style={{
          display: "flex",
          justifyContent: "center",
          paddingTop: "var(--sp-7)",
          paddingBottom: "var(--sp-8)",
          paddingLeft: "var(--sp-6)",
          paddingRight: "var(--sp-6)",
        }}
      >
        <PairClient
          code={code}
          fingerprint={fingerprint}
          initialKind="signed-out"
          expiresIn={expiresIn}
          signInHref={`/auth?next=${encodeURIComponent(`/pair?code=${code}`)}`}
        />
      </main>
    );
  }

  // Expired code
  if (!pairingRowExists || isExpired) {
    return (
      <main
        style={{
          display: "flex",
          justifyContent: "center",
          paddingTop: "var(--sp-7)",
          paddingBottom: "var(--sp-8)",
          paddingLeft: "var(--sp-6)",
          paddingRight: "var(--sp-6)",
        }}
      >
        <PairClient
          code={code}
          fingerprint={fingerprint}
          initialKind="failure"
          failureReason="expired"
        />
      </main>
    );
  }

  // Check for existing device (conflict check — D-04)
  const { data: existingDevice } = await supabase
    .from("devices")
    .select("name, gpu, last_seen")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingDevice) {
    return (
      <main
        style={{
          display: "flex",
          justifyContent: "center",
          paddingTop: "var(--sp-7)",
          paddingBottom: "var(--sp-8)",
          paddingLeft: "var(--sp-6)",
          paddingRight: "var(--sp-6)",
        }}
      >
        <PairClient
          code={code}
          fingerprint={fingerprint}
          initialKind="conflict"
          existingDevice={existingDevice}
          expiresIn={expiresIn}
        />
      </main>
    );
  }

  // Default signed-in state
  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        paddingTop: "var(--sp-7)",
        paddingBottom: "var(--sp-8)",
        paddingLeft: "var(--sp-6)",
        paddingRight: "var(--sp-6)",
      }}
    >
      <PairClient
        code={code}
        fingerprint={fingerprint}
        initialKind="default"
        expiresIn={expiresIn}
      />
    </main>
  );
}
