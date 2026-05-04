// Tests for frontend/lib/pairing/code.ts — strict pairing-code validator.
//
// Contract (Plan 08-03 D-03):
//   - Accept canonical 8-char Crockford-base32 codes formatted "XXXX-XXXX".
//   - Reject anything else: lowercase, missing hyphen, wrong length, ambiguous I/L/O/U.
//   - No normalization — the URL is the source of truth.

import { describe, it, expect } from "vitest";

import { isValidPairingCode } from "@/lib/pairing/code";

describe("isValidPairingCode", () => {
  it("accepts a canonical code (K7H2-Q9X3)", () => {
    expect(isValidPairingCode("K7H2-Q9X3")).toBe(true);
  });

  it("accepts an all-digits code (1234-5678)", () => {
    expect(isValidPairingCode("1234-5678")).toBe(true);
  });

  it("rejects lowercase input (k7h2-q9x3)", () => {
    expect(isValidPairingCode("k7h2-q9x3")).toBe(false);
  });

  it("rejects a code containing O (zero-letter ambiguity)", () => {
    expect(isValidPairingCode("K7H2-O9X3")).toBe(false);
  });

  it("rejects a code containing I (one-letter ambiguity)", () => {
    expect(isValidPairingCode("K7I2-Q9X3")).toBe(false);
  });

  it("rejects a code containing L", () => {
    expect(isValidPairingCode("K7L2-Q9X3")).toBe(false);
  });

  it("rejects a code containing U", () => {
    expect(isValidPairingCode("K7U2-Q9X3")).toBe(false);
  });

  it("rejects code with no hyphen (K7H2Q9X3)", () => {
    expect(isValidPairingCode("K7H2Q9X3")).toBe(false);
  });

  it("rejects extra trailing chars (K7H2-Q9X3X)", () => {
    expect(isValidPairingCode("K7H2-Q9X3X")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidPairingCode("")).toBe(false);
  });

  it("rejects whitespace-padded code", () => {
    expect(isValidPairingCode(" K7H2-Q9X3 ")).toBe(false);
  });

  it("rejects code with a space instead of hyphen", () => {
    expect(isValidPairingCode("K7H2 Q9X3")).toBe(false);
  });
});
