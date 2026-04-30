"""CORE-06 (merge half) + L7: canonical jsonb payload shape."""

from __future__ import annotations

from app.pipeline.merge import _max_overlap, merge_to_payload
from app.schemas import TranscriptPayload


def test_empty_inputs_produce_empty_payload() -> None:
    out = merge_to_payload({"language": "en", "segments": []}, [])
    assert out["version"] == 1
    assert out["duration_sec"] == 0.0
    assert out["segments"] == [] and out["speakers"] == []
    # pydantic validate
    TranscriptPayload(**out)


def test_single_segment_full_overlap() -> None:
    asr = {
        "language": "en",
        "segments": [
            {
                "start": 0.0,
                "end": 5.0,
                "text": "hi",
                "words": [{"w": "hi", "s": 0.0, "e": 5.0, "p": 0.99}],
            }
        ],
    }
    diar = [{"start": 0.0, "end": 5.0, "speaker": "SPEAKER_03"}]
    out = merge_to_payload(asr, diar)
    assert out["segments"][0]["speaker"] == "S0"
    assert out["speakers"] == [{"id": "S0", "label": "Speaker 1"}]
    TranscriptPayload(**out)


def test_three_segments_two_speakers_renumber() -> None:
    asr = {
        "language": "en",
        "segments": [
            {"start": 0.0, "end": 1.0, "text": "a", "words": []},
            {"start": 1.0, "end": 2.0, "text": "b", "words": []},
            {"start": 2.0, "end": 3.0, "text": "c", "words": []},
        ],
    }
    diar = [
        {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_07"},
        {"start": 1.0, "end": 2.0, "speaker": "SPEAKER_02"},
        {"start": 2.0, "end": 3.0, "speaker": "SPEAKER_07"},
    ]
    out = merge_to_payload(asr, diar)
    speakers_seen = {s["speaker"] for s in out["segments"]}
    assert speakers_seen == {"S0", "S1"}
    assert out["segments"][0]["speaker"] == out["segments"][2]["speaker"]
    assert out["segments"][1]["speaker"] != out["segments"][0]["speaker"]
    assert out["duration_sec"] == 3.0
    TranscriptPayload(**out)


def test_no_overlap_falls_back_to_unknown_renamed() -> None:
    asr = {
        "language": "en",
        "segments": [{"start": 10.0, "end": 12.0, "text": "x", "words": []}],
    }
    diar = [{"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00"}]
    out = merge_to_payload(asr, diar)
    # No overlap → SPEAKER_UNKNOWN sentinel; renumbered to S0
    assert out["segments"][0]["speaker"] == "S0"
    TranscriptPayload(**out)


def test_max_overlap_returns_unknown_when_no_match() -> None:
    assert _max_overlap(0.0, 1.0, []) == "SPEAKER_UNKNOWN"
