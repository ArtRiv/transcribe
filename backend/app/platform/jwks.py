"""JWKS / JWT verification helper (Phase 2 ships the import surface; Phase 4 wires).

``PyJWKClient`` is constructed lazily inside ``verify_supabase_jwt`` so module
import is free of network calls (matters for tests + lifespan latency, and for
the SecretInLog / JWKSNetCall mitigations in 02-05's threat model).

Phase 4 tightens the verification semantics via the ``strict`` parameter:
  - ``strict=False`` (legacy): swallows all exceptions, returns ``None`` on any
    failure. Preserved for callers that have not yet migrated.
  - ``strict=True``: verifies ``aud='authenticated'``, enforces ``exp``, and
    re-raises PyJWT errors so callers can distinguish bad tokens from missing
    tokens and surface 401 rather than silently treating invalid JWTs as
    anonymous. See RESEARCH §Pattern 7; Assumption A5 (T-04-AUTH-FORGERY,
    T-04-AUTH-AUDIENCE, T-04-AUTH-LEAK in threat model).
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

import jwt
from jwt import PyJWKClient


@lru_cache(maxsize=1)
def _jwks_client(jwks_url: str) -> PyJWKClient:
    """Cache the PyJWKClient per JWKS URL (typically only one per process)."""
    return PyJWKClient(jwks_url)


def verify_supabase_jwt(
    token: str,
    *,
    jwks_url: str | None = None,
    strict: bool = False,
) -> dict[str, Any] | None:
    """Verify a Supabase JWT against the project JWKS endpoint.

    Parameters
    ----------
    token:
        The raw JWT string (without the ``Bearer `` prefix).
    jwks_url:
        The JWKS endpoint URL. Typically
        ``{SUPABASE_URL}/auth/v1/.well-known/jwks.json``.
    strict:
        When ``False`` (default / Phase 2 legacy): returns ``None`` on any
        failure — safe for optional-auth paths.
        When ``True`` (Phase 4 required-auth paths): verifies
        ``aud='authenticated'``, enforces ``exp``, and *re-raises* PyJWT
        errors so the caller can distinguish "tampered token" (→ 401) from
        "no token" (→ anonymous path or 401 on required routes).
        [Cited: 04-RESEARCH.md §Pattern 7; T-04-AUTH-FORGERY,
        T-04-AUTH-AUDIENCE]

    Returns
    -------
    dict | None
        Decoded claims dict on success; ``None`` only when ``strict=False``
        and verification fails.

    Raises
    ------
    jwt.PyJWTError
        When ``strict=True`` and the token is invalid for any reason
        (bad signature, wrong audience, expired, malformed).
    """
    if not token or not jwks_url:
        if strict:
            raise jwt.PyJWTError("token or jwks_url missing")
        return None

    if strict:
        client = _jwks_client(jwks_url)
        signing_key = client.get_signing_key_from_jwt(token).key
        # Re-raise all PyJWT errors — no swallowing in strict mode.
        # audience="authenticated" covers both anon and signed-in Supabase tokens
        # (both share aud='authenticated'; the difference is is_anonymous claim).
        return jwt.decode(
            token,
            signing_key,
            algorithms=["ES256", "RS256", "HS256"],
            audience="authenticated",
            options={
                "verify_aud": True,
                "verify_exp": True,
                "verify_signature": True,
            },
        )

    # Legacy lenient path (Phase 2 behaviour preserved).
    try:
        client = _jwks_client(jwks_url)
        signing_key = client.get_signing_key_from_jwt(token).key
        return jwt.decode(
            token,
            signing_key,
            algorithms=["ES256", "RS256"],
            options={"verify_aud": False},  # Phase 2 legacy — not tightened here
        )
    except Exception:
        return None
