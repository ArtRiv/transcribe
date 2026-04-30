"""CORE-06 (diar half) + L2 — pyannote-CPU runs on a tiny clip and pins to CPU."""

from pathlib import Path

import pytest

pytest.importorskip("pyannote.audio")
pytest.importorskip("torch")

FIXTURES = Path(__file__).parent / "fixtures" / "audio"


@pytest.mark.slow
async def test_diarize_real_pyannote_cpu(real_pipeline) -> None:
    from app.pipeline.diarize import diarize as pyannote_diarize

    # Use the smallest clip
    wav = FIXTURES / "one_word_silence_15s.wav"
    if not wav.exists():
        pytest.skip("one_word_silence_15s.wav fixture missing")

    # CPU pin verified at fixture load (load_pyannote asserts it). pyannote 3.x
    # Pipeline is not a torch.nn.Module — use the .device attribute directly.
    assert real_pipeline.pipeline.device.type == "cpu"

    turns = await pyannote_diarize(real_pipeline.pipeline, str(wav), num_speakers=None)
    # On a 15s clip with mostly silence + one word, pyannote may return 0 or 1
    # turn — both acceptable.
    assert isinstance(turns, list)
    for t in turns:
        assert "start" in t and "end" in t and "speaker" in t
        assert float(t["start"]) <= float(t["end"])
