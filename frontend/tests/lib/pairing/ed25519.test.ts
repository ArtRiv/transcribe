// Tests for frontend/lib/pairing/ed25519.ts — Ed25519 verify wrapper.
//
// Test vectors are RFC 8032 §7.1 (TEST 1 + TEST 2) — also generated via PyNaCl
// for cross-impl verification. The frontend NEVER generates keys — it only
// verifies signatures the engine produced. The negative tests below
// (T-08-03-03 mitigation) are the load-bearing checks: a flipped sig bit OR a
// modified message must both return false.

import { describe, it, expect } from "vitest";

import { hexToBytes, bytesToHex, verifyEd25519 } from "@/lib/pairing/ed25519";

// RFC 8032 §7.1 — TEST 2 (single-byte message 0x72)
// Cross-checked against PyNaCl SigningKey(seed) where
// seed = 4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb.
const TEST_PUBKEY_HEX =
  "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";
const TEST_MSG_HEX = "72";
const TEST_SIG_HEX =
  "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00";

describe("hexToBytes / bytesToHex", () => {
  it("hexToBytes parses an even-length hex string", () => {
    expect(hexToBytes("00ff10")).toEqual(new Uint8Array([0x00, 0xff, 0x10]));
  });

  it("hexToBytes is case-insensitive", () => {
    expect(hexToBytes("AaBbCc")).toEqual(hexToBytes("aabbcc"));
  });

  it("hexToBytes throws on odd-length input", () => {
    expect(() => hexToBytes("abc")).toThrow();
  });

  it("hexToBytes throws on non-hex chars", () => {
    expect(() => hexToBytes("zz")).toThrow();
  });

  it("hexToBytes round-trips with bytesToHex", () => {
    const original = TEST_SIG_HEX;
    expect(bytesToHex(hexToBytes(original))).toBe(original);
  });
});

describe("verifyEd25519", () => {
  it("returns true for the RFC 8032 §7.1 TEST 2 vector", async () => {
    const ok = await verifyEd25519(
      hexToBytes(TEST_MSG_HEX),
      hexToBytes(TEST_SIG_HEX),
      hexToBytes(TEST_PUBKEY_HEX),
    );
    expect(ok).toBe(true);
  });

  it("returns false when the signature is bit-flipped", async () => {
    const sig = hexToBytes(TEST_SIG_HEX);
    sig[0] ^= 0x01; // flip one bit
    const ok = await verifyEd25519(
      hexToBytes(TEST_MSG_HEX),
      sig,
      hexToBytes(TEST_PUBKEY_HEX),
    );
    expect(ok).toBe(false);
  });

  it("returns false when the message is modified", async () => {
    const msg = new Uint8Array([0x72, 0x73]); // append a byte
    const ok = await verifyEd25519(
      msg,
      hexToBytes(TEST_SIG_HEX),
      hexToBytes(TEST_PUBKEY_HEX),
    );
    expect(ok).toBe(false);
  });

  it("returns false when the pubkey is a different key", async () => {
    const wrongPubkey = hexToBytes(
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    );
    const ok = await verifyEd25519(
      hexToBytes(TEST_MSG_HEX),
      hexToBytes(TEST_SIG_HEX),
      wrongPubkey,
    );
    expect(ok).toBe(false);
  });

  it("returns false (not throws) on malformed signature length", async () => {
    // 64 bytes is required; 32 bytes must be rejected gracefully so the route
    // can return a clean 401 instead of crashing.
    const ok = await verifyEd25519(
      hexToBytes(TEST_MSG_HEX),
      new Uint8Array(32),
      hexToBytes(TEST_PUBKEY_HEX),
    );
    expect(ok).toBe(false);
  });
});
