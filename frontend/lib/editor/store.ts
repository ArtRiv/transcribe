// Zustand store — holds the original File reference per job_id (D-14).
// The editor (Plan 03-13) reads on mount, creates an Object URL for
// <audio src>, revokes on unmount.
//
// Per RESEARCH §Pitfall 4, we keep at most ONE entry in the store: when the
// user opens a different job, the previous job's File ref is dropped so the
// browser can GC the multi-MB Blob. This is a deliberate trade-off — Phase 4
// may add IndexedDB persistence (D-16) for cross-tab/cross-reload support.

import { create } from "zustand";

interface EditorStore {
  /** At most one entry — the currently active job's File reference. */
  fileRefByJobId: Record<string, File>;
  setFile: (jobId: string, file: File) => void;
  clearFile: (jobId: string) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  fileRefByJobId: {},

  // Drops any previously-cached File refs so only the current job's File
  // is retained. Pitfall 4 prevention.
  setFile: (jobId, file) =>
    set(() => ({ fileRefByJobId: { [jobId]: file } })),

  clearFile: (jobId) =>
    set((s) => {
      if (!(jobId in s.fileRefByJobId)) return s;
      const next = { ...s.fileRefByJobId };
      delete next[jobId];
      return { fileRefByJobId: next };
    }),
}));
