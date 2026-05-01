"""Quick task 260430-noo — verify --language is always passed to whisper-cli.

whisper-cli's `--language` defaults to "en" when omitted (verified via
`whisper-cli --help`). Skipping the flag for non-English audio causes
Portuguese (and other) inputs to be transcribed as English instead of in
the source language. The fix in transcribe._build_whisper_args always
passes the flag, defaulting to "auto" when the caller omits a language.
"""

from __future__ import annotations

from pathlib import Path

from app.pipeline.transcribe import _build_whisper_args


def _flag_value(args: list[str], flag: str) -> str | None:
    """Return the value following `flag` in the args list, or None if absent."""
    try:
        i = args.index(flag)
    except ValueError:
        return None
    return args[i + 1] if i + 1 < len(args) else None


def _build(language: str | None) -> list[str]:
    return _build_whisper_args(
        "/bin/whisper-cli",
        "/tmp/model.bin",
        Path("/tmp/in.wav"),
        Path("/tmp/in.json"),
        language=language,
        vad_model_path="/tmp/vad.bin",
    )


def test_language_none_passes_auto() -> None:
    assert _flag_value(_build(None), "--language") == "auto"


def test_language_empty_string_passes_auto() -> None:
    """Empty string from form encoding should also collapse to 'auto'."""
    assert _flag_value(_build(""), "--language") == "auto"


def test_language_auto_passes_auto() -> None:
    assert _flag_value(_build("auto"), "--language") == "auto"


def test_language_pt_passes_pt() -> None:
    """Brazilian Portuguese — the user's repro from 2026-04-30."""
    assert _flag_value(_build("pt"), "--language") == "pt"


def test_language_en_passes_en() -> None:
    assert _flag_value(_build("en"), "--language") == "en"


def test_language_flag_always_present() -> None:
    """Defense in depth: regardless of caller input, the args list MUST
    contain --language so we never fall back to whisper-cli's "en" default."""
    for lang in (None, "", "auto", "pt", "en", "ja", "zh"):
        assert "--language" in _build(lang), f"missing --language for {lang!r}"
