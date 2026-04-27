"""Pytest fixtures: ASGI lifespan + httpx AsyncClient.

Pattern source: 01-RESEARCH.md "Validation Architecture".

These fixtures make it trivial for Phase 2 onward to add tests like:

    async def test_jobs_post_enqueues(client):
        r = await client.post("/jobs", json={...})
        assert r.status_code == 202

without each test having to wire up its own lifespan + transport.
"""

from collections.abc import AsyncIterator

import pytest
from asgi_lifespan import LifespanManager
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from app.main import app as fastapi_app


@pytest.fixture
async def lifespan_app() -> AsyncIterator[FastAPI]:
    """Yield a FastAPI app with its lifespan started; teardown shuts it down.

    NOTE: asgi-lifespan ≥2 wraps the app via `state_middleware`, so `manager.app`
    is a callable (not a FastAPI). We yield the original `fastapi_app` because
    its `.state` is the same object the lifespan startup populates, and tests
    that need to introspect state want the FastAPI instance, not the wrapper.
    """
    async with LifespanManager(fastapi_app):
        yield fastapi_app


@pytest.fixture
async def client(lifespan_app: FastAPI) -> AsyncIterator[AsyncClient]:
    """In-process httpx AsyncClient against the lifespan-managed app."""
    transport = ASGITransport(app=lifespan_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
