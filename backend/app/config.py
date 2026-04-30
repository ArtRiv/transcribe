"""Environment configuration loader.

Reads backend/.env (gitignored) using pydantic-settings. The .env file is created
from the repo-root .env.example by Plan 05 (Supabase migrations + per-app env wiring).

Phase 1 only NEEDS BACKEND_HOST/BACKEND_PORT to bind /healthz.
Phase 2 enforces presence of HF_TOKEN, WHISPER_MODEL_PATH, etc. at startup.
Phase 4 enforces SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY at JWT-validate time.

SECURITY: SUPABASE_SERVICE_ROLE_KEY is read here so backend code can use it.
It MUST NEVER be exposed to the frontend (no NEXT_PUBLIC_* equivalent).
The repo .gitignore + gitleaks pre-commit (Plan 02) enforce this at commit time.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Backend env vars. Defaults are deliberately permissive for Phase 1 bootstrap;
    downstream phases enforce presence at the points each value is consumed.
    """

    # ── HTTP bind ──────────────────────────────────────────────────────────
    backend_host: str = Field(default="127.0.0.1")
    backend_port: int = Field(default=8000)
    log_level: str = Field(default="info")

    # ── Supabase (Phase 4 enforces) ────────────────────────────────────────
    supabase_url: str = Field(default="")
    supabase_service_role_key: str = Field(default="")
    supabase_db_url: str = Field(default="")

    # ── Hugging Face (Phase 2 enforces for diarization) ────────────────────
    hf_token: str = Field(default="")

    # ── whisper.cpp (Phase 2 enforces) ─────────────────────────────────────
    whisper_model_path: str = Field(default="")
    whisper_cpp_build_dir: str = Field(default="")
    whisper_bin_path: str = Field(default="")  # full path to whisper-cli binary
    # Silero VAD model path. Required by whisper.cpp 1.8+ when --vad is set.
    # If empty, the lifespan resolves to ``models_dir / 'ggml-silero-v5.1.2.bin'``;
    # if that file is missing too, transcribe_subprocess fails fast at startup.
    whisper_vad_model_path: str = Field(default="")

    # ── Models + lifecycle (Phase 2; CORE-07) ──────────────────────────────
    models_dir: Path = Field(
        default_factory=lambda: Path.home() / ".transcribe" / "models"
    )
    uploads_dir: Path = Field(
        default_factory=lambda: Path.home() / ".transcribe" / "uploads"
    )
    work_dir: Path = Field(
        default_factory=lambda: Path.home() / ".transcribe" / "work"
    )

    # ── Model SHA-256 pins (Phase 2; CLAUDE.md "Critical pinning") ─────────
    model_small_sha256: str = Field(default="")
    model_medium_sha256: str = Field(default="")
    model_turbo_sha256: str = Field(default="")
    model_large_sha256: str = Field(default="")  # only used if enable_slow_preset=true
    model_vad_silero_sha256: str = Field(default="")  # ggml-silero-v5.1.2.bin

    # ── Preset gating (Phase 2; OPTS-07) ───────────────────────────────────
    enable_slow_preset: bool = Field(default=False)

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,  # SUPABASE_URL == supabase_url
        extra="ignore",  # tolerate extra vars (e.g., NEXT_PUBLIC_* if symlinked)
    )


@lru_cache
def get_settings() -> Settings:
    """Return process-wide settings singleton (instantiated on first call)."""
    return Settings()
