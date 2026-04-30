"""Transcribe backend — FastAPI service for whisper.cpp + pyannote transcription.

Phase 1 ships only the /healthz endpoint and the env-loading scaffold.
Phase 2 adds the lifespan model loading, asyncio queue, and TUS upload routes.
"""

__version__ = "0.1.0"
