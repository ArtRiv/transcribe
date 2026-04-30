import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useAutosave,
  readSavedEdits,
  clearSavedEdits,
  _STORAGE_KEY,
} from "@/lib/editor/persist";
import { SAMPLE_PAYLOAD } from "@/lib/mock/data";

describe("persist (autosave + restore)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces writes by 500 ms (D-29)", () => {
    const jobId = "test-1";
    const { rerender } = renderHook(({ s }) => useAutosave(jobId, s), {
      initialProps: { s: SAMPLE_PAYLOAD },
    });
    // Immediately after mount, nothing in storage.
    expect(window.localStorage.getItem(_STORAGE_KEY(jobId))).toBeNull();
    act(() => {
      vi.advanceTimersByTime(499);
    });
    // Still not saved at 499 ms.
    expect(window.localStorage.getItem(_STORAGE_KEY(jobId))).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    // At 501 ms the write fires.
    const raw = window.localStorage.getItem(_STORAGE_KEY(jobId));
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { updatedAt: number };
    expect(typeof parsed.updatedAt).toBe("number");
    // Cleanup so the unmount doesn't queue another write.
    rerender({ s: SAMPLE_PAYLOAD });
  });

  it("readSavedEdits round-trips updatedAt + state", () => {
    const jobId = "test-2";
    const snapshot = { updatedAt: 1234567890, state: SAMPLE_PAYLOAD };
    window.localStorage.setItem(_STORAGE_KEY(jobId), JSON.stringify(snapshot));
    const out = readSavedEdits(jobId);
    expect(out?.updatedAt).toBe(1234567890);
    expect(out?.state.segments.length).toBe(SAMPLE_PAYLOAD.segments.length);
  });

  it("readSavedEdits returns null when nothing is saved", () => {
    expect(readSavedEdits("never-stored")).toBeNull();
  });

  it("readSavedEdits returns null when the JSON is malformed", () => {
    window.localStorage.setItem(_STORAGE_KEY("bad"), "not json");
    expect(readSavedEdits("bad")).toBeNull();
  });

  it("clearSavedEdits removes the entry", () => {
    const jobId = "test-3";
    window.localStorage.setItem(_STORAGE_KEY(jobId), '{"updatedAt":1,"state":{}}');
    clearSavedEdits(jobId);
    expect(window.localStorage.getItem(_STORAGE_KEY(jobId))).toBeNull();
  });

  it("storage key uses the transcribe.edits. prefix (D-29)", () => {
    expect(_STORAGE_KEY("abc-123")).toBe("transcribe.edits.abc-123");
  });

  it("returns SaveStatus 'error' when localStorage.setItem throws (Pitfall 6 / Safari private mode)", () => {
    const jobId = "test-quota";
    const setItem = vi
      .spyOn(window.localStorage.__proto__, "setItem")
      .mockImplementation(() => {
        const err: Error & { name: string } = new Error("Quota exceeded") as Error & { name: string };
        err.name = "QuotaExceededError";
        throw err;
      });
    const { result } = renderHook(() => useAutosave(jobId, SAMPLE_PAYLOAD));
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current.kind).toBe("error");
    setItem.mockRestore();
  });
});
