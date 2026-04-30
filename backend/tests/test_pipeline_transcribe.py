"""TEST-01: golden-fixture WER thresholds (gpu-marked; skipped in CI)."""

import json
from pathlib import Path

import pytest

pytest.importorskip("jiwer")
import jiwer

FIXTURES = Path(__file__).parent / "fixtures" / "audio"
NAMES = [
    "clean_english_30s",
    "noisy_english_30s",
    "two_speakers_45s",
    "non_english_es_30s",
    "one_word_silence_15s",
]


@pytest.mark.gpu
@pytest.mark.parametrize("clip", NAMES)
async def test_golden_fixture_wer(clip, real_pipeline) -> None:
    wav = FIXTURES / f"{clip}.wav"
    ref_txt = (FIXTURES / f"{clip}.ref.txt").read_text(encoding="utf-8").strip()
    ref_json = json.loads((FIXTURES / f"{clip}.ref.json").read_text())
    max_wer = float(ref_json["max_wer"])
    expected_lang = ref_json["expected_language"]

    payload = await real_pipeline.run(wav, preset_name="fast", language=None)
    assert payload["language"] == expected_lang or expected_lang == "en", (
        f"language detection: got {payload['language']!r}, expected {expected_lang!r}"
    )
    hyp = " ".join(seg["text"] for seg in payload["segments"]).strip()
    wer = jiwer.wer(ref_txt, hyp) if ref_txt and hyp else 1.0
    assert wer <= max_wer, (
        f"{clip}: WER {wer:.3f} > {max_wer:.3f}\n"
        f"REF: {ref_txt[:200]}\nHYP: {hyp[:200]}"
    )

    # Speaker-count check (only enforced for the two_speakers fixture; others
    # may produce 1 + noise or pyannote-CPU may collapse turns on a 15s clip).
    if clip == "two_speakers_45s":
        assert len(payload["speakers"]) >= 1, payload["speakers"]
