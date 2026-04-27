# Transcribe — Backend

FastAPI service that runs whisper.cpp (Vulkan ASR) + pyannote.audio (CPU diarization) on the developer's GPU host.

Phase 1 ships only `/healthz`. Phases 2-5 build the transcription pipeline, queue, TUS upload endpoints, and rate limiting.

## Run

```bash
cd backend
uv sync                                                # install deps from uv.lock
uv run uvicorn app.main:app --reload --port 8000       # dev
curl http://localhost:8000/healthz                     # {"status":"ok"}
```

## Test

```bash
uv run pytest -x          # fast feedback
uv run pytest             # full suite
uv run ruff check .       # lint
uv run ruff format .      # format
```

## Architecture (Phase 1 placeholder)

```
backend/
  app/
    main.py          # FastAPI() + /healthz; Phase 2 adds lifespan model loading + queue + /jobs
    config.py        # pydantic-settings env loader (reads backend/.env)
    __init__.py
  tests/
    conftest.py      # ASGI lifespan + httpx AsyncClient fixtures
    test_health.py   # asserts /healthz 200
  scripts/
    # Phase 2: tunnel.sh, transcribe_local.py, verify_phase1.sh, etc.
  pyproject.toml
  .python-version    # 3.11
  uv.lock
```

Bound to `127.0.0.1:8000` by default (cloudflared connects to localhost; SAFE-04 in Phase 5 hardens this).
