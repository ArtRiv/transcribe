// In-memory TUS state machine for Phase 3 mock mode (D-20).
//
// Mirrors backend/app/routes/tus.py lines 42-72: each upload gets an
// entry in a Map<uploadId, { offset, length, completed, metadata }>. PATCH
// increments offset, HEAD returns current state, DELETE drops the entry.
//
// MAX_CHUNK is the same defensive cap as backend/app/routes/tus.py:46
// (100 MB). Real-mode TUS client (lib/tus/upload-client.ts) sends 90 MB.

export const MAX_CHUNK = 100 * 1024 * 1024;
export const TUS_VERSION = "1.0.0";

interface TusUpload {
  offset: number;
  length: number;
  completed: boolean;
  metadata: Record<string, string>;
  filename?: string;
}

const uploads = new Map<string, TusUpload>();

export function createUpload(
  uploadId: string,
  length: number,
  metadata: Record<string, string>,
): void {
  uploads.set(uploadId, {
    offset: 0,
    length,
    completed: false,
    metadata,
    filename: metadata.filename,
  });
}

export function getUpload(uploadId: string): TusUpload | undefined {
  return uploads.get(uploadId);
}

/** Advance offset on PATCH. Returns the new offset. */
export function advanceOffset(uploadId: string, chunkBytes: number): number {
  const u = uploads.get(uploadId);
  if (!u) throw new Error(`No upload ${uploadId}`);
  const capped = Math.min(chunkBytes, MAX_CHUNK);
  u.offset = Math.min(u.offset + capped, u.length);
  if (u.offset >= u.length) u.completed = true;
  return u.offset;
}

export function deleteUpload(uploadId: string): void {
  uploads.delete(uploadId);
}

/** Parse Upload-Metadata header (RFC: comma-separated `key b64-value`). */
export function parseUploadMetadata(
  header: string | null,
): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const pair of header.split(",")) {
    const [key, b64] = pair.trim().split(/\s+/);
    if (!key) continue;
    try {
      out[key] = b64 ? atob(b64) : "";
    } catch {
      out[key] = b64 ?? "";
    }
  }
  return out;
}
