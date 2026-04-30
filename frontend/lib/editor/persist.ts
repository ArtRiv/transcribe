// localStorage debounced autosave + restore-on-mount (D-29 / D-30).
//
// Storage key: `transcribe.edits.${jobId}` (D-29).
// Debounce: 500 ms (D-29).
// Quota fallback: try/catch around setItem — Safari private mode reports
// a 0 quota and throws QuotaExceededError. Surface UI is via a saveStatus
// signal (Plan 03-13 wires the warn pill).

import { useEffect, useRef, useState } from "react";
import type { EditorState } from "./reducer";

const STORAGE_KEY = (jobId: string) => `transcribe.edits.${jobId}`;
const DEBOUNCE_MS = 500;

export interface SavedSnapshot {
  updatedAt: number;       // Unix ms
  state: EditorState;
}

export type SaveStatus =
  | { kind: "idle" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

/**
 * Mirror state into localStorage with a 500 ms trailing debounce.
 * Returns the SaveStatus signal (Plan 03-13 renders the footer indicator).
 */
export function useAutosave(jobId: string, state: EditorState): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      try {
        const snapshot: SavedSnapshot = { updatedAt: Date.now(), state };
        window.localStorage.setItem(STORAGE_KEY(jobId), JSON.stringify(snapshot));
        setStatus({ kind: "saved", at: snapshot.updatedAt });
      } catch (err) {
        // Safari private mode quota = 0, or browser-side SecurityError.
        const message = err instanceof Error ? err.message : "Storage write failed";
        setStatus({ kind: "error", message });
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [jobId, state]);

  return status;
}

/** Read the saved snapshot for a given job_id (D-30 restore-pill source). */
export function readSavedEdits(jobId: string): SavedSnapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY(jobId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSnapshot;
    if (
      typeof parsed?.updatedAt !== "number" ||
      typeof parsed?.state !== "object"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Drop the saved snapshot — used by Discard branch of D-30 restore-pill. */
export function clearSavedEdits(jobId: string): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY(jobId));
  } catch {
    /* swallow */
  }
}

/** Internal — exposed for tests so they don't need to hardcode the prefix. */
export const _STORAGE_KEY = STORAGE_KEY;
