"""Pydantic schema contract tests (Phase 2→3 stable surface).

These tests lock the JobCreateRequest validation behaviour and the canonical
TranscriptPayload shape. The TranscriptPayload is the contract shape that
lands in transcripts.payload (jsonb, RESEARCH.md §1329-1356).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError


def test_schemas_importable() -> None:
    """All public schema names import cleanly."""
    from app.schemas import (  # noqa: F401
        JobCreateRequest,
        JobResponse,
        PresetName,
        ReadyzResponse,
        Segment,
        Speaker,
        TranscriptPayload,
        Word,
    )


def test_jobcreate_request_defaults() -> None:
    """JobCreateRequest(preset='fast') constructs with safe defaults (diarize=True, others None)."""
    from app.schemas import JobCreateRequest

    j = JobCreateRequest(preset="fast")
    assert j.preset == "fast"
    assert j.language is None
    assert j.num_speakers is None
    assert j.diarize is True


def test_jobcreate_invalid_preset_raises() -> None:
    """preset is Literal-restricted to fast/average/average_turbo/slow."""
    from app.schemas import JobCreateRequest

    with pytest.raises(ValidationError):
        JobCreateRequest(preset="invalid")


def test_jobcreate_num_speakers_zero_is_auto() -> None:
    """num_speakers=0 (and "" / "0" from form encoding) collapse to None for
    'Auto' diarization. Old browser bundles + the TUS metadata path send 0
    or empty string when the slider is at Auto; the schema must accept both
    rather than 400. Quick task 260430-mwn."""
    from app.schemas import JobCreateRequest

    assert JobCreateRequest(preset="fast", num_speakers=0).num_speakers is None
    assert JobCreateRequest(preset="fast", num_speakers="0").num_speakers is None  # type: ignore[arg-type]
    assert JobCreateRequest(preset="fast", num_speakers="").num_speakers is None  # type: ignore[arg-type]
    # Negative still fails (genuine bad input, not the Auto sentinel).
    with pytest.raises(ValidationError):
        JobCreateRequest(preset="fast", num_speakers=-1)


def test_jobcreate_num_speakers_upper_bound() -> None:
    """num_speakers must be <= 20."""
    from app.schemas import JobCreateRequest

    with pytest.raises(ValidationError):
        JobCreateRequest(preset="fast", num_speakers=21)


def test_jobcreate_extra_forbid() -> None:
    """JobCreateRequest rejects unknown fields (extra='forbid')."""
    from app.schemas import JobCreateRequest

    with pytest.raises(ValidationError):
        JobCreateRequest(preset="fast", unknown_field="x")


def test_transcript_payload_minimal() -> None:
    """A minimal TranscriptPayload constructs and defaults to empty speakers/segments."""
    from app.schemas import TranscriptPayload

    p = TranscriptPayload(version=1, language="en", duration_sec=1.0)
    assert p.version == 1
    assert p.language == "en"
    assert p.duration_sec == 1.0
    assert p.speakers == []
    assert p.segments == []


def test_transcript_payload_full_shape() -> None:
    """Round-trip a fully populated TranscriptPayload (the §1329-1356 shape)."""
    from app.schemas import Segment, Speaker, TranscriptPayload, Word

    p = TranscriptPayload(
        version=1,
        language="en",
        duration_sec=10.0,
        speakers=[Speaker(id="S0", label="Speaker 1")],
        segments=[
            Segment(
                id="seg_0000",
                start=0.0,
                end=1.0,
                speaker="S0",
                text="hi",
                words=[Word(w="hi", s=0.0, e=1.0, p=0.95)],
            )
        ],
    )
    assert p.segments[0].speaker == "S0"
    assert p.segments[0].words[0].p == 0.95
