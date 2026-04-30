"""TEST-04 — 20-job memory soak. Falsifiable acceptance criterion of Phase 2.

Methodology (refined from the original 02-RESEARCH.md Pattern 11; the original
post-job-1 vs post-job-20 delta was a false-positive on PyTorch+glibc allocator
warmup — see deviation note in 02-09-SUMMARY.md):

  - 3 warmup jobs (discarded). Settles the PyTorch CPU caching allocator pool,
    glibc malloc arenas (pyannote diarization is multi-threaded), and pyannote
    internal lazy initialization. By job 4 the working set is stable on this
    stack (whisper.cpp Vulkan + pyannote 3.x CPU + torch 2.5 CPU).
  - 17 measurement jobs (jobs 4..20) through the real pipeline + 30 s clip.
  - VRAM via sysfs `/sys/class/drm/cardN/device/mem_info_vram_used` (whisper.cpp's
    own ggml_backend_vk_get_device_memory is broken — issue #3254). USS via
    psutil `Process().memory_full_info().uss` (Pitfall 6 — RSS includes shared
    library pages and is ~10x noisier).

Two checks gate the test, both applied independently to VRAM and USS:

  1. Windowed mean comparison: mean(jobs 4..7) vs mean(jobs 17..20). Fail if
     drift > 2%. Both windows are post-warmup steady-state, so any drift is
     genuine progressive growth, not allocator settling.
  2. Linear regression slope across jobs 4..20. Fail if |slope| > 0.5 MB/job.
     Catches a continuous slow leak even when endpoints happen to align.

Combined sensitivity: detects ~0.5 MB/job continuous leaks. (The previous 5%
single-point delta masked anything under ~1.6 MB/job — that's a real leak
slipping through the original methodology.)

On failure, dumps:
  - per-job VRAM/USS table
  - early/late window means + slopes
  - `malloc_trim(0)` before/after USS — if the gap drops, it's allocator caching
    not a leak (canonical glibc diagnostic)
  - full `psutil.memory_full_info()` split (RSS/VMS/USS/PSS/shared/swap) —
    disambiguates leak vs shared-library bloat vs swap
  - `tracemalloc` top-10 — Python-layer allocation hotspots
"""

import contextlib
import ctypes
import gc
import statistics
import tracemalloc
from pathlib import Path

import numpy as np
import psutil
import pytest

from app.platform.memory import (
    find_amd_card_dir,
    host_rss_mb,
    vram_used_bytes,
)

FIXTURES = Path(__file__).parent / "fixtures" / "audio"
SOAK_CLIP = "clean_english_30s.wav"

WARMUP_JOBS = 3
TOTAL_JOBS = 20  # measurement jobs run from WARMUP_JOBS+1 .. TOTAL_JOBS

# Windows are inclusive ranges over job number. EARLY = first 4 post-warmup
# jobs; LATE = last 4 jobs of the run. Two non-overlapping windows.
EARLY_WINDOW = range(WARMUP_JOBS + 1, WARMUP_JOBS + 5)   # jobs 4..7
LATE_WINDOW = range(TOTAL_JOBS - 3, TOTAL_JOBS + 1)      # jobs 17..20

WINDOWED_DRIFT_PCT_LIMIT = 2.0
SLOPE_MB_PER_JOB_LIMIT = 0.5


def _malloc_trim() -> None:
    """Force glibc to release trimmable pages back to the kernel.

    Diagnostic only. If USS drops noticeably after `malloc_trim(0)`, the gap
    is allocator caching (heap fragmentation that the kernel can reclaim),
    NOT a real leak. Glibc-specific; silently no-op on non-glibc systems.
    """
    with contextlib.suppress(OSError, AttributeError):
        ctypes.CDLL("libc.so.6").malloc_trim(0)


def _mean_over(readings: list[dict], window: range, key: str) -> float:
    return statistics.mean(r[key] for r in readings if r["job"] in window)


@pytest.mark.gpu
@pytest.mark.slow
async def test_20_job_soak(real_pipeline) -> None:
    wav = FIXTURES / SOAK_CLIP
    if not wav.exists():
        pytest.skip(f"{SOAK_CLIP} fixture missing")

    try:
        card = find_amd_card_dir()
    except RuntimeError as e:
        pytest.skip(f"AMD card not found: {e}")

    tracemalloc.start()

    # ── Warmup (NOT measured) ─────────────────────────────────────────────────
    for _ in range(WARMUP_JOBS):
        await real_pipeline.run(wav, preset_name="fast", language="en")
        gc.collect()

    # ── Measurement jobs ──────────────────────────────────────────────────────
    readings: list[dict] = []
    for job_n in range(WARMUP_JOBS + 1, TOTAL_JOBS + 1):
        await real_pipeline.run(wav, preset_name="fast", language="en")
        gc.collect()
        readings.append(
            {
                "job": job_n,
                "vram_used_mb": vram_used_bytes(card) // (1024 * 1024),
                "host_uss_mb": host_rss_mb(),
            }
        )

    # ── Windowed comparison ───────────────────────────────────────────────────
    early_vram = _mean_over(readings, EARLY_WINDOW, "vram_used_mb")
    late_vram = _mean_over(readings, LATE_WINDOW, "vram_used_mb")
    early_uss = _mean_over(readings, EARLY_WINDOW, "host_uss_mb")
    late_uss = _mean_over(readings, LATE_WINDOW, "host_uss_mb")

    vram_drift_pct = abs(late_vram - early_vram) / max(early_vram, 1) * 100
    uss_drift_pct = abs(late_uss - early_uss) / max(early_uss, 1) * 100

    # ── Slope (least-squares fit, MB per job) ─────────────────────────────────
    xs = np.array([r["job"] for r in readings], dtype=float)
    vram_slope = float(
        np.polyfit(xs, np.array([r["vram_used_mb"] for r in readings], dtype=float), 1)[0]
    )
    uss_slope = float(
        np.polyfit(xs, np.array([r["host_uss_mb"] for r in readings], dtype=float), 1)[0]
    )

    # ── Verdict ───────────────────────────────────────────────────────────────
    failures: list[str] = []
    if vram_drift_pct > WINDOWED_DRIFT_PCT_LIMIT:
        failures.append(
            f"VRAM windowed drift {vram_drift_pct:.2f}% > "
            f"{WINDOWED_DRIFT_PCT_LIMIT}% "
            f"(early={early_vram:.1f} MB, late={late_vram:.1f} MB)"
        )
    if uss_drift_pct > WINDOWED_DRIFT_PCT_LIMIT:
        failures.append(
            f"USS windowed drift {uss_drift_pct:.2f}% > "
            f"{WINDOWED_DRIFT_PCT_LIMIT}% "
            f"(early={early_uss:.1f} MB, late={late_uss:.1f} MB)"
        )
    if abs(vram_slope) > SLOPE_MB_PER_JOB_LIMIT:
        failures.append(
            f"VRAM slope {vram_slope:+.2f} MB/job exceeds "
            f"±{SLOPE_MB_PER_JOB_LIMIT} MB/job"
        )
    if abs(uss_slope) > SLOPE_MB_PER_JOB_LIMIT:
        failures.append(
            f"USS slope {uss_slope:+.2f} MB/job exceeds "
            f"±{SLOPE_MB_PER_JOB_LIMIT} MB/job"
        )

    # Always print the summary header (so a green run still records the numbers
    # in -s mode, useful for the SUMMARY.md write-up). Per-job table only on
    # failure to keep passing-run output compact.
    print(
        f"\n--- soak summary "
        f"(warmup={WARMUP_JOBS}, measured jobs {WARMUP_JOBS + 1}..{TOTAL_JOBS}) ---"
    )
    print(
        f"  Early window mean (jobs "
        f"{EARLY_WINDOW.start}..{EARLY_WINDOW.stop - 1}): "
        f"VRAM={early_vram:.1f} MB, USS={early_uss:.1f} MB"
    )
    print(
        f"  Late  window mean (jobs "
        f"{LATE_WINDOW.start}..{LATE_WINDOW.stop - 1}): "
        f"VRAM={late_vram:.1f} MB, USS={late_uss:.1f} MB"
    )
    print(
        f"  Drift:    VRAM={vram_drift_pct:.2f}% (limit "
        f"{WINDOWED_DRIFT_PCT_LIMIT}%), USS={uss_drift_pct:.2f}% (limit "
        f"{WINDOWED_DRIFT_PCT_LIMIT}%)"
    )
    print(
        f"  Slope:    VRAM={vram_slope:+.3f} MB/job, USS={uss_slope:+.3f} MB/job "
        f"(limit ±{SLOPE_MB_PER_JOB_LIMIT})"
    )

    if failures:
        # ── Diagnostic dumps (failure path only) ──────────────────────────────
        print("\n--- per-job table ---")
        for r in readings:
            print(
                f"  job {r['job']:>2}: "
                f"VRAM={r['vram_used_mb']} MB, USS={r['host_uss_mb']} MB"
            )

        # malloc_trim — if USS drops, the gap is allocator caching not a leak.
        uss_before_trim = host_rss_mb()
        _malloc_trim()
        uss_after_trim = host_rss_mb()
        released = uss_before_trim - uss_after_trim
        verdict = (
            "allocator caching, not a leak"
            if released > 5
            else "no significant release"
        )
        print(
            f"\n--- malloc_trim(0) diagnostic ---\n"
            f"  USS before trim: {uss_before_trim} MB\n"
            f"  USS after  trim: {uss_after_trim} MB\n"
            f"  Released:        {released} MB ({verdict})"
        )

        # Full memory split — disambiguates leak vs shared lib vs swap.
        full = psutil.Process().memory_full_info()
        print(
            f"\n--- psutil memory_full_info (post-soak) ---\n"
            f"  RSS:    {full.rss // (1024 * 1024)} MB\n"
            f"  VMS:    {full.vms // (1024 * 1024)} MB\n"
            f"  USS:    {full.uss // (1024 * 1024)} MB\n"
            f"  PSS:    {full.pss // (1024 * 1024)} MB\n"
            f"  Shared: {full.shared // (1024 * 1024)} MB\n"
            f"  Swap:   {full.swap // (1024 * 1024)} MB"
        )

        # Python-layer allocation hotspots.
        snapshot = tracemalloc.take_snapshot()
        top_stats = snapshot.statistics("lineno")[:10]
        print("\n--- tracemalloc top 10 (Python-only allocations) ---")
        for stat in top_stats:
            print(f"  {stat}")

        tracemalloc.stop()
        pytest.fail("; ".join(failures))

    tracemalloc.stop()
