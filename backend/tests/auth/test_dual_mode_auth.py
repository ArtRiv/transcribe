"""Phase 4 backend auth dependency tests (no GPU required).

Mocks verify_supabase_jwt to avoid live JWKS fetch.
[Cited: 04-RESEARCH.md §Pattern 7; 04-PATTERNS.md test_routes_smoke pattern]
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request


def _request(headers: dict[str, str] | None = None, settings_url: str = "https://t.supabase.co") -> Request:
    """Build a minimal Starlette Request with given headers + app.state.settings."""

    class _Settings:
        supabase_url = settings_url

    class _State:
        settings = _Settings()

    class _App:
        state = _State()

    scope = {
        "type": "http",
        "method": "GET",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "app": _App(),
    }
    return Request(scope)


def test_get_user_required_rejects_no_authorization() -> None:
    from app.routes.deps import get_user_required

    with pytest.raises(HTTPException) as exc:
        get_user_required(_request(headers={}))
    assert exc.value.status_code == 401


def test_get_user_required_rejects_malformed_authorization() -> None:
    from app.routes.deps import get_user_required

    with pytest.raises(HTTPException) as exc:
        get_user_required(_request(headers={"Authorization": "Token xyz"}))
    assert exc.value.status_code == 401


def test_get_user_required_rejects_invalid_signature() -> None:
    import jwt
    from app.routes.deps import get_user_required

    with patch("app.routes.deps.verify_supabase_jwt", side_effect=jwt.InvalidSignatureError()):
        with pytest.raises(HTTPException) as exc:
            get_user_required(_request(headers={"Authorization": "Bearer faketoken"}))
        assert exc.value.status_code == 401


def test_get_user_required_accepts_valid_signed_in_jwt() -> None:
    from app.routes.deps import get_user_required

    claims = {"sub": "user-uuid", "aud": "authenticated", "is_anonymous": False}
    with patch("app.routes.deps.verify_supabase_jwt", return_value=claims):
        out = get_user_required(_request(headers={"Authorization": "Bearer goodtoken"}))
    assert out["sub"] == "user-uuid"
    assert out["is_anonymous"] is False


def test_get_user_required_accepts_valid_anon_jwt() -> None:
    from app.routes.deps import get_user_required

    claims = {"sub": "anon-uuid", "aud": "authenticated", "is_anonymous": True}
    with patch("app.routes.deps.verify_supabase_jwt", return_value=claims):
        out = get_user_required(_request(headers={"Authorization": "Bearer anontoken"}))
    assert out["is_anonymous"] is True


def test_get_user_optional_returns_none_when_no_header() -> None:
    from app.routes.deps import get_user_optional

    assert get_user_optional(_request(headers={})) is None


def test_get_user_optional_raises_on_invalid_token() -> None:
    import jwt
    from app.routes.deps import get_user_optional

    # Header present + invalid → must raise (not silently return None).
    with patch("app.routes.deps.verify_supabase_jwt", side_effect=jwt.InvalidSignatureError()):
        with pytest.raises(HTTPException):
            get_user_optional(_request(headers={"Authorization": "Bearer x"}))


def test_get_user_optional_returns_claims_when_valid() -> None:
    from app.routes.deps import get_user_optional

    claims = {"sub": "user-uuid", "aud": "authenticated", "is_anonymous": False}
    with patch("app.routes.deps.verify_supabase_jwt", return_value=claims):
        out = get_user_optional(_request(headers={"Authorization": "Bearer goodtoken"}))
    assert out is not None
    assert out["sub"] == "user-uuid"


def test_verify_supabase_jwt_strict_audience(monkeypatch: pytest.MonkeyPatch) -> None:
    """When strict=True, audience='authenticated' is enforced."""
    import jwt as _jwt
    from app.platform import jwks as jwks_mod

    # Forge a token signed with HS256 just to exercise the decode-options branch.
    token = _jwt.encode({"sub": "x", "aud": "wrong-audience"}, "secret", algorithm="HS256")

    # Monkeypatch the PyJWKClient to return our HS256 secret as the signing key.
    class _FakeKey:
        key = "secret"

    class _FakeClient:
        def get_signing_key_from_jwt(self, t: str) -> _FakeKey:
            return _FakeKey()

    # Clear lru_cache on _jwks_client and patch it to return our fake client.
    monkeypatch.setattr(jwks_mod, "_jwks_client", lambda url: _FakeClient())
    with pytest.raises(_jwt.PyJWTError):
        jwks_mod.verify_supabase_jwt(token, jwks_url="https://ignored", strict=True)


def test_verify_supabase_jwt_strict_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    """When strict=True, a bad signature raises rather than returning None."""
    import jwt as _jwt
    from app.platform import jwks as jwks_mod

    # Sign with one key, try to verify with a different key.
    token = _jwt.encode({"sub": "x", "aud": "authenticated"}, "real-secret", algorithm="HS256")

    class _FakeKey:
        key = "wrong-secret"

    class _FakeClient:
        def get_signing_key_from_jwt(self, t: str) -> _FakeKey:
            return _FakeKey()

    monkeypatch.setattr(jwks_mod, "_jwks_client", lambda url: _FakeClient())
    with pytest.raises(_jwt.PyJWTError):
        jwks_mod.verify_supabase_jwt(token, jwks_url="https://ignored", strict=True)
