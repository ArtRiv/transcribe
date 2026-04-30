#!/usr/bin/env python3
"""Standalone CLI: WAV -> canonical TranscriptPayload printed as JSON.

Used to author golden-fixture .ref.txt files and as a sanity probe for the
CORE-06 pipeline outside the FastAPI app.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.config import get_settings
from app.pipeline.diarize import diarize as pyannote_diarize
from app.pipeline.diarize import load_pyannote
from app.pipeline.merge import merge_to_payload
from app.pipeline.normalize import normalize_to_wav
from app.pipeline.presets import PRESETS
from app.pipeline.transcribe import transcribe_subprocess


async def _run(args) -> dict:
    settings = get_settings()
    if not settings.whisper_bin_path:
        sys.exit(
            "ERROR: WHISPER_BIN_PATH not set; "
            "run backend/scripts/build_whisper_cpp.sh first"
        )
    if args.preset not in PRESETS:
        sys.exit(
            f"ERROR: unknown preset {args.preset!r}; "
            f"choose from {list(PRESETS.keys())}"
        )

    src = Path(args.audio).resolve()
    if not src.exists():
        sys.exit(f"ERROR: audio file not found: {src}")

    wav = src.with_suffix(".wav") if src.suffix.lower() != ".wav" else src
    if wav != src:
        await normalize_to_wav(src, wav)

    preset = PRESETS[args.preset]
    model_path = str(Path(settings.models_dir) / preset["model_filename"])
    vad_model_path = (
        settings.whisper_vad_model_path
        or str(Path(settings.models_dir) / "ggml-silero-v5.1.2.bin")
    )
    cancel = asyncio.Event()
    asr = await transcribe_subprocess(
        settings.whisper_bin_path,
        model_path,
        wav,
        language=args.language,
        on_progress=None,
        cancel_event=cancel,
        vad_model_path=vad_model_path,
    )

    diar: list[dict] = []
    if not args.no_diarize:
        pipe = await load_pyannote(settings)
        diar = await pyannote_diarize(pipe, str(wav), num_speakers=args.num_speakers)

    return merge_to_payload(asr, diar)


def main() -> None:
    ap = argparse.ArgumentParser(description="Standalone Phase 2 pipeline CLI")
    ap.add_argument("audio", help="Path to audio/video file")
    ap.add_argument(
        "--preset", default="fast", help="fast / average / average_turbo / slow"
    )
    ap.add_argument("--language", default=None, help="ISO 639-1 (None = auto)")
    ap.add_argument(
        "--num-speakers", type=int, default=None, help="None = auto-detect"
    )
    ap.add_argument(
        "--no-diarize", action="store_true", help="Skip pyannote (ASR only)"
    )
    args = ap.parse_args()

    payload = asyncio.run(_run(args))
    json.dump(payload, sys.stdout, indent=2, ensure_ascii=False)
    print()


if __name__ == "__main__":
    main()
