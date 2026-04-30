"""CORE-05: ffmpeg normalize to 16 kHz mono PCM WAV."""

from __future__ import annotations

import asyncio
import subprocess
from pathlib import Path

import pytest

from app.pipeline.normalize import normalize_to_wav


async def test_normalize_real_ffmpeg(tmp_path: Path) -> None:
    """Real ffmpeg: a 1-sec 440 Hz stereo WAV → 16 kHz mono PCM s16le WAV."""
    src = tmp_path / "tone.wav"
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1:sample_rate=44100",
        "-ac",
        "2",
        str(src),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    await proc.wait()
    assert src.exists(), "test fixture not created"

    dst = tmp_path / "out.wav"
    await normalize_to_wav(src, dst)
    assert dst.exists()

    # Probe the output
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "stream=sample_rate,channels,codec_name",
        "-of",
        "csv=p=0",
        str(dst),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    # ffprobe emits the streams in the order it lists them via -show_entries; on
    # current ffmpeg builds (probed live 2026-04-28) that's `codec_name,sample_rate,channels`.
    assert out.decode().strip() == "pcm_s16le,16000,1", out.decode()


async def test_normalize_missing_source_raises(tmp_path: Path) -> None:
    """Calling normalize_to_wav on a missing source path raises RuntimeError."""
    with pytest.raises(RuntimeError, match="ffmpeg failed"):
        await normalize_to_wav(tmp_path / "nonexistent.wav", tmp_path / "out.wav")
