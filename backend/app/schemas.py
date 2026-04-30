"""Pydantic request/response models + canonical TranscriptPayload (Phase 2→3 contract).

The TranscriptPayload shape is locked in 02-RESEARCH.md §1329-1356 and lands
in transcripts.payload (jsonb). Phase 3's editor and exporters read this shape;
bumping `version` is the only safe way to break it.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PresetName = Literal["fast", "average", "average_turbo", "slow"]


# ── Request bodies ────────────────────────────────────────────────────────


class JobCreateRequest(BaseModel):
    """POST /jobs body (multipart < 90 MB) AND TUS Upload-Metadata payload.

    Mirrors OPTS-07 (preset enum) and the diarize/language toggles surfaced
    in the upload modal (PROJECT.md "Active" requirements). `extra="forbid"`
    so unknown fields fail loudly rather than silently dropping client typos.
    """

    model_config = ConfigDict(extra="forbid")

    preset: PresetName
    language: str | None = Field(
        default=None,
        description="ISO 639-1 language code; None means auto-detect.",
    )
    num_speakers: int | None = Field(
        default=None,
        ge=1,
        le=20,
        description="Fixed speaker count for diarization; None means auto-detect.",
    )
    diarize: bool = Field(
        default=True,
        description="Run pyannote speaker diarization. Off = ASR-only output.",
    )


# ── Response bodies ───────────────────────────────────────────────────────


class JobResponse(BaseModel):
    """Returned by POST /jobs (multipart) and the TUS finalize hand-off."""

    job_id: str
    status: str  # "queued" / "running" / "succeeded" / "failed" / "cancelled"


class ReadyzResponse(BaseModel):
    """GET /readyz body. ready = lifespan complete, model loaded, queue running."""

    status: Literal["ready", "starting"]
    vulkan_device: str | None
    presets_available: list[PresetName]


# ── Canonical jsonb payload (RESEARCH.md §1329-1356, Phase 2→3 contract) ──


class Word(BaseModel):
    """Per-word timing + confidence inside a Segment."""

    model_config = ConfigDict(extra="forbid")

    w: str
    s: float
    e: float
    p: float = 1.0


class Segment(BaseModel):
    """One contiguous speaker turn (or chunk thereof) with text + word timings."""

    model_config = ConfigDict(extra="forbid")

    id: str
    start: float
    end: float
    speaker: str  # e.g., "S0"
    text: str
    words: list[Word] = Field(default_factory=list)


class Speaker(BaseModel):
    """A speaker label entry. `id` is the stable key; `label` is renamable in Phase 3."""

    model_config = ConfigDict(extra="forbid")

    id: str  # "S0" / "S1" / ...
    label: str  # human-readable; renamable in Phase 3 editor


class TranscriptPayload(BaseModel):
    """The single jsonb column on transcripts.payload. Phase 2→3 contract.

    Bumping `version` is the only safe way to break this shape — Phase 3's
    editor + exporters read it directly.
    """

    model_config = ConfigDict(extra="forbid")

    version: int = 1
    language: str
    duration_sec: float
    speakers: list[Speaker] = Field(default_factory=list)
    segments: list[Segment] = Field(default_factory=list)
