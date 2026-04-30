"""FastAPI dependency callables (Phase 4 wires JWT-based auth).

Phase 2 left ``get_optional_user`` as a no-op stub. Phase 4 introduces
``get_user_required`` (raises 401 on missing/invalid JWT) and
``get_user_optional`` (returns None on missing, raises on invalid).

[Cited: 04-RESEARCH.md §Pattern 7; 04-PATTERNS.md backend/app/routes/deps.py row]
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request, status

from app.platform.jwks import verify_supabase_jwt


def get_settings_dep(request: Request) -> Any:
    """Resolve the singleton ``Settings`` placed on ``app.state`` by lifespan."""
    return request.app.state.settings


def get_job_manager(request: Request) -> Any:
    """Return the JobManager (Phase 2 surface) or ``None`` if not yet wired.

    Routes must defensively check the result so the endpoint is exercisable
    in tests + the early-Wave 2 lifespan before the queue lands.
    """
    return getattr(request.app.state, "jobs", None)


def get_user_required(request: Request) -> dict[str, Any]:
    """Return verified JWT claims; reject unauthenticated requests with 401.

    Both signed-in users and anonymous-sign-in users present a JWT; the
    only difference is the ``is_anonymous`` claim. Routes that care
    about that distinction inspect ``claims['is_anonymous']``.

    Raises
    ------
    HTTPException(401)
        On any of: missing Authorization header, non-Bearer scheme, empty
        token, signature failure, wrong audience, expired token.

    Security note: exceptions from the JWT verifier are intentionally not
    forwarded to the client (T-04-AUTH-LEAK) — only a bare 401 is returned.
    [Cited: 04-RESEARCH.md §Pattern 7]
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or malformed Authorization header",
        )
    token = auth.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    settings = request.app.state.settings
    jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    try:
        claims = verify_supabase_jwt(token, jwks_url=jwks_url, strict=True)
    except Exception:
        # All PyJWT errors → 401; never leak verifier internals (T-04-AUTH-LEAK).
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED) from None
    if claims is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return claims


def get_user_optional(request: Request) -> dict[str, Any] | None:
    """Same as required, but tolerates absent Authorization header.

    Returns ``None`` when the header is missing entirely; raises 401 when the
    header IS present but invalid (so a tampered token cannot be silently
    treated as anonymous). This prevents a spoofed/expired JWT from gaining
    anonymous access to routes that call this dependency.
    """
    if not request.headers.get("Authorization"):
        return None
    return get_user_required(request)


# ---------------------------------------------------------------------------
# Legacy alias — kept for one phase to ease migration of any caller still
# importing the Phase 2 stub. Marked deprecated; remove in Phase 5.
# ---------------------------------------------------------------------------


def get_optional_user(request: Request) -> dict[str, Any] | None:
    """[DEPRECATED] Phase 2 alias. Use ``get_user_optional`` going forward."""
    return get_user_optional(request)
