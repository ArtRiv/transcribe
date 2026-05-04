// frontend/lib/pairing/ed25519.ts
//
// Ed25519 verify wrapper for the Vercel edge route (Plan 08-04 / 08-06).
//
// Why this module exists:
//   - The engine signs the pairing-confirm challenge with PyNaCl Ed25519.
//   - The Vercel route /api/pair/confirm verifies the signature with the
//     pubkey stored on the device row.
//   - We delegate to @noble/ed25519 (audited, edge-runtime safe — pure JS,
//     no Node-only crypto).
//
// On @noble/ed25519 v2.3 the synchronous `verify` requires injecting a
// sha512 implementation. The async `verifyAsync` works out of the box —
// it uses WebCrypto's `crypto.subtle.digest('SHA-512', …)`, which Edge
// runtime + browsers + modern Node all expose. We export only the async
// wrapper so callers cannot accidentally pull `verify` and crash.
//
// Plain Ed25519 only (RFC 8032 §5.1). @noble/ed25519's `verifyAsync` does
// NOT support Ed25519ph / Ed25519ctx — switching variants would require a
// different module entirely (T-08-03-05 mitigation).

import { verifyAsync } from "@noble/ed25519";

const HEX_RE = /^[0-9a-fA-F]*$/;

/**
 * Parse an even-length hex string into a Uint8Array.
 * Throws on odd length or non-hex characters.
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length input (${hex.length})`);
  }
  if (!HEX_RE.test(hex)) {
    throw new Error("hexToBytes: non-hex character in input");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Encode a Uint8Array as lowercase hex. */
export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

/**
 * Verify a 64-byte Ed25519 signature against (message, pubkey).
 *
 * Returns false rather than throws on any structural error (wrong sig
 * length, malformed pubkey point), so the route handler can return a
 * clean 401 without a try/catch.
 *
 * @param message  The exact bytes that were signed (no hashing here).
 * @param signature 64-byte detached Ed25519 signature.
 * @param pubkey    32-byte raw Ed25519 public key.
 */
export async function verifyEd25519(
  message: Uint8Array,
  signature: Uint8Array,
  pubkey: Uint8Array,
): Promise<boolean> {
  try {
    return await verifyAsync(signature, message, pubkey);
  } catch {
    // Invalid sig length, non-canonical point, etc. Treat as "not verified".
    return false;
  }
}
