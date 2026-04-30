"""Tests for transcribe.py pure-python helpers (no GPU; gpu test ships in 02-09)."""

from __future__ import annotations

from app.pipeline.transcribe import _TS_RE, _normalize_payload, _threads, _ts_to_seconds


def test_ts_to_seconds() -> None:
    assert _ts_to_seconds(0, 0, 1, 500) == 1.5
    assert _ts_to_seconds(0, 1, 23, 450) == 83.45
    assert _ts_to_seconds(1, 0, 0, 0) == 3600.0


def test_ts_regex_matches_segment_line() -> None:
    line = "[00:01:23.450 --> 00:01:27.890]   Some transcribed text\n"
    m = _TS_RE.search(line)
    assert m is not None
    # 'to' timestamp = group indices 4-7
    assert _ts_to_seconds(*m.groups()[4:]) == 87.89


def test_threads_caps_at_eight_and_minimum_one() -> None:
    """_threads always returns a positive int and never exceeds 8."""
    n = _threads()
    assert isinstance(n, int)
    assert 1 <= n <= 8


def test_normalize_payload_filters_special_tokens() -> None:
    """Special-token tokens (id >= 50257 OR text starting with '[_') are dropped."""
    raw = {
        "result": {"language": "en"},
        "transcription": [
            {
                "offsets": {"from": 100, "to": 1500},
                "text": "  hello world",
                "tokens": [
                    # id 50300 >= 50257 → filtered out (special)
                    {
                        "text": " hello",
                        "offsets": {"from": 100, "to": 600},
                        "id": 50300,
                        "p": 0.9,
                    },
                    # text starts with '[_' AND id 50360 >= 50257 → filtered
                    {
                        "text": "[_BEG_]",
                        "offsets": {"from": 600, "to": 700},
                        "id": 50360,
                        "p": 1.0,
                    },
                    # id 1234 < 50257 AND non-empty text → kept
                    {
                        "text": " world",
                        "offsets": {"from": 700, "to": 1500},
                        "id": 1234,
                        "p": 0.85,
                    },
                    # empty text → dropped (id 256 < 50257 but no content)
                    {
                        "text": "",
                        "offsets": {"from": 1500, "to": 1500},
                        "id": 256,
                        "p": 1.0,
                    },
                ],
            }
        ],
    }
    out = _normalize_payload(raw)
    assert out["language"] == "en"
    assert len(out["segments"]) == 1
    seg = out["segments"][0]
    assert seg["start"] == 0.1 and seg["end"] == 1.5
    assert seg["text"] == "hello world"

    words_text = [w["w"] for w in seg["words"]]
    # Only the content token "world" (id 1234) survives; both special-vocab
    # tokens (50300, 50360) and the empty-text token are filtered out.
    assert words_text == ["world"], words_text
    # Word offsets land in seconds (ms / 1000)
    assert seg["words"][0]["s"] == 0.7
    assert seg["words"][0]["e"] == 1.5
    assert seg["words"][0]["p"] == 0.85


def test_normalize_payload_empty_input() -> None:
    out = _normalize_payload({"result": {"language": "es"}, "transcription": []})
    assert out == {"language": "es", "segments": []}


def test_normalize_payload_negative_id_filtered() -> None:
    """Tokens with id < 0 are filtered (defensive — shouldn't happen but guard
    against malformed JSON)."""
    raw = {
        "result": {"language": "en"},
        "transcription": [
            {
                "offsets": {"from": 0, "to": 1000},
                "text": "x",
                "tokens": [
                    {
                        "text": "x",
                        "offsets": {"from": 0, "to": 1000},
                        "id": -1,
                        "p": 1.0,
                    },
                ],
            }
        ],
    }
    out = _normalize_payload(raw)
    assert out["segments"][0]["words"] == []
