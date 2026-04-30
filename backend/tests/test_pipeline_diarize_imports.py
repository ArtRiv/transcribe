"""Diarize module import-time invariants (no HF call, no GPU)."""

from __future__ import annotations


def test_diarize_imports_without_network() -> None:
    """Import alone must succeed without contacting HF."""
    from app.pipeline import diarize

    assert hasattr(diarize, "load_pyannote") and hasattr(diarize, "diarize")


def test_diarize_uses_run_in_executor() -> None:
    """L2 + Pitfall 2: source must wrap PyTorch calls in run_in_executor and
    pin the pipeline to torch.device('cpu')."""
    import inspect

    from app.pipeline import diarize

    src = inspect.getsource(diarize)
    assert "run_in_executor" in src, "diarize must wrap PyTorch calls in run_in_executor"
    assert 'torch.device("cpu")' in src or "torch.device('cpu')" in src, (
        "L2 invariant: pipeline.to(torch.device('cpu')) must be present"
    )
    # Pitfall 2: explicit CPU-pin assertion in source
    assert "device.type" in src, "Pitfall 2: must assert device.type after .to(cpu)"
