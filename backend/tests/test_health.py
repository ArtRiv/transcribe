"""Phase 1 smoke test: /healthz returns 200 + expected body.

Proves the FastAPI app boots, the lifespan runs, and the route table is wired.
Phase 2 will add tests for /readyz, /jobs, and the queue worker.
"""

from fastapi import FastAPI
from httpx import AsyncClient


async def test_healthz_returns_ok(client: AsyncClient) -> None:
    """GET /healthz returns 200 with {"status": "ok"}."""
    response = await client.get("/healthz")
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "ok"}


async def test_healthz_no_authentication_required(client: AsyncClient) -> None:
    """SAFE-04 prerequisite: /healthz is liveness-only, no auth gate (Phase 5 verifies)."""
    # No Authorization header sent; should still 200.
    response = await client.get("/healthz")
    assert response.status_code == 200


async def test_app_state_settings_loaded(client: AsyncClient, lifespan_app: FastAPI) -> None:
    """Lifespan startup populates app.state.settings (Phase 2 will add model handles)."""
    assert hasattr(lifespan_app.state, "settings"), "lifespan didn't set app.state.settings"
    # Defaults exist (no real env required for Phase 1)
    assert lifespan_app.state.settings.backend_port == 8000
