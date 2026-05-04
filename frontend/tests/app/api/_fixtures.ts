// Shared test fixtures for signal-token route tests.
// RFC 8032 §7.1 TEST 2 keypair — deterministic, cross-checked against PyNaCl.
// These values are PUBLIC test vectors; they are NOT secrets.

import { hexToBytes } from "@/lib/pairing/ed25519";
import { signAsync } from "@noble/ed25519";

/** RFC 8032 §7.1 TEST 2 — 32-byte Ed25519 public key (hex). */
export const TEST_PUBKEY_HEX =
  "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";

/** RFC 8032 §7.1 TEST 2 — 32-byte Ed25519 private key seed (hex). */
const TEST_PRIVKEY_SEED_HEX =
  "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";

/** Pre-parsed public key bytes for convenience. */
export const TEST_PUBKEY_BYTES = hexToBytes(TEST_PUBKEY_HEX);

/**
 * Sign an arbitrary message string with the test private key.
 * Returns a hex-encoded 64-byte Ed25519 signature.
 */
export async function signMessage(message: string): Promise<string> {
  const msgBytes = new TextEncoder().encode(message);
  const privKeyBytes = hexToBytes(TEST_PRIVKEY_SEED_HEX);
  const sigBytes = await signAsync(msgBytes, privKeyBytes);
  return Array.from(sigBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The pubkey column in Supabase is stored as base64 (bytea representation). */
export const TEST_PUBKEY_BASE64 =
  Buffer.from(TEST_PUBKEY_BYTES).toString("base64");

/**
 * Build a mock Supabase admin client.
 * - `deviceRow`: the row returned from devices.select().eq('pubkey', ...).single()
 */
export function mockAdminClient(opts: {
  deviceRow?: { user_id: string; pubkey: string } | null;
}): {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: unknown,
      ) => { single: () => Promise<{ data: unknown; error: unknown }> };
    };
  };
} {
  return {
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          single: async () => ({
            data: opts.deviceRow ?? null,
            error: opts.deviceRow
              ? null
              : { message: "not found", code: "PGRST116" },
          }),
        }),
      }),
    }),
  };
}
