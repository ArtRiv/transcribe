// frontend/lib/pairing/code.ts
//
// Strict validator for engine pairing codes (Plan 08-03).
// The engine generates an 8-char Crockford-base32 code formatted "XXXX-XXXX"
// (alphabet 0-9 + A-Z minus I/L/O/U). The frontend never generates a code —
// it only validates user-pasted / URL-supplied input.
//
// No normalization (no lowercase coercion). The deep-link URL is the source of
// truth; if the user pasted lowercase or stripped the hyphen, that is a typo
// and we surface "invalid code" rather than silently fix it.

const PAIRING_CODE_RE = /^[0-9A-HJKMNPQRSTVWXYZ]{4}-[0-9A-HJKMNPQRSTVWXYZ]{4}$/;

/** True when `code` matches the canonical Crockford-base32 pairing-code shape. */
export function isValidPairingCode(code: string): boolean {
  return PAIRING_CODE_RE.test(code);
}
