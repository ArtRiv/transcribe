// TUS chunked upload wrapper (CORE-04 large-file path).
//
// chunkSize MUST be 90 MB exactly. The Cloudflare Quick Tunnel rejects
// bodies > 100 MB at the edge with HTTP 413; the 10 MB headroom absorbs
// header + boundary overhead. RAISING the chunk size to "be more efficient"
// breaks the upload silently. PROJECT.md and Phase 02-04 lock this constant.
// [Cited: RESEARCH §Pitfall 3; backend/app/routes/tus.py line 46 MAX_CHUNK = 100 * 1024 * 1024]

import * as tus from "tus-js-client";

/** 90 MB exactly — under Cloudflare Tunnel 100 MB body cap. DO NOT CHANGE. */
export const TUS_CHUNK_SIZE = 90 * 1024 * 1024;

/** Exponential-ish backoff per RESEARCH §Pattern 3 line 502. */
export const TUS_RETRY_DELAYS = [0, 1000, 3000, 5000, 10000] as const;

export interface UploadHandlers {
  onProgress: (bytesSent: number, bytesTotal: number) => void;
  onSuccess: (uploadUrl: string) => void;
  onError: (err: Error) => void;
}

/**
 * Start a TUS chunked upload. Returns the underlying tus.Upload so the
 * caller can call .abort() to cancel. Per RESEARCH §Pattern 3 line 521,
 * abort() returns a Promise — DO NOT await from a synchronous cancel
 * handler; fire-and-forget is correct.
 *
 * @param authHeaders - Optional HTTP headers for the upload-creation POST.
 *   Phase 4 (Plan 04-05): pass `{ Authorization: 'Bearer <jwt>' }` for FastAPI
 *   auth. Do NOT forward to PATCH chunk requests — auth is established at creation.
 *   [Cited: 04-PLAN 04-05 Task 3; T-04-AUTH-NONCLAIM threat note]
 */
export function startTusUpload(
  file: File,
  endpoint: string,
  handlers: UploadHandlers,
  metadata?: Record<string, string>,
  authHeaders?: Record<string, string>,
): tus.Upload {
  const upload = new tus.Upload(file, {
    endpoint,
    chunkSize: TUS_CHUNK_SIZE,
    retryDelays: [...TUS_RETRY_DELAYS],
    metadata: {
      filename: file.name,
      "content-type": file.type || "application/octet-stream",
      ...(metadata ?? {}),
    },
    // Auth header on upload-creation only (TUS protocol: auth established at POST,
    // not repeated on PATCH chunk requests which carry the tus-resumable + upload-offset).
    headers: authHeaders ?? {},
    onProgress: handlers.onProgress,
    onSuccess: () => handlers.onSuccess(upload.url ?? ""),
    onError: handlers.onError,
  });
  upload.start();
  return upload;
}
