// Multipart-vs-TUS routing for POST /jobs (CORE-04 client side).
//
// Threshold (90 MB) MUST match backend/app/routes/jobs.py line 32
// SMALL_PATH_LIMIT — the server gates on the same value.
//
// For files < 90 MB: plain multipart fetch to NEXT_PUBLIC_BACKEND_URL/jobs.
// For files >= 90 MB: tus-js-client uploads chunks, then the backend's
// tus.py creates the jobs row on completion.
//
// Phase 4 (Plan 04-05): Authorization header attached to POST /jobs and TUS
// upload-creation (Plan 04-04 backend requires Bearer <jwt>).
// NOT attached to TUS PATCH chunk requests — auth is established at upload-creation.
// [Cited: 04-PLAN 04-05 Task 3; T-04-AUTH-NONCLAIM threat note]

import type { Upload } from "tus-js-client";
import { env } from "@/lib/env";
import { newJobId } from "./id";
import { startTusUpload, type UploadHandlers } from "@/lib/tus/upload-client";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** 90 MB exactly — backend SMALL_PATH_LIMIT. Comment cites the contract. */
export const SMALL_PATH_LIMIT = 90 * 1024 * 1024;

/** PresetName matches backend Literal["fast", "average", "average_turbo", "slow"]. */
export type PresetName = "fast" | "average" | "average_turbo" | "slow";

export interface JobOptions {
  preset: PresetName;
  language?: string;        // BCP-47 short code, omitted for auto-detect
  num_speakers?: number;    // 0 = auto, otherwise pinned count
  diarize: boolean;
}

/** Decision branch — exposed for Vitest coverage (CORE-04 acceptance). */
export function decideUploadPath(file: { size: number }): "multipart" | "tus" {
  return file.size < SMALL_PATH_LIMIT ? "multipart" : "tus";
}

export interface SubmitJobResult {
  jobId: string;
  uploadHandle?: Upload;  // present only for TUS path; caller can call .abort()
}

/**
 * Returns the Authorization header for FastAPI requests.
 *
 * NOTE: getSession() is used here to read the access_token from cookie storage
 * for FORWARDING to FastAPI. This is NOT an authorization decision — FastAPI
 * re-verifies the JWT signature via JWKS (Plan 04-04). Client-side authorization
 * decisions use getUser() (round-trip-verified) per Pitfall 5.
 * [Cited: 04-PLAN 04-05 Task 3 comment; T-04-AUTH-NONCLAIM threat note]
 */
async function authHeader(): Promise<Record<string, string>> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {};
}

export async function submitJob(
  file: File,
  options: JobOptions,
  handlers: UploadHandlers,
): Promise<SubmitJobResult> {
  const jobId = newJobId();
  const path = decideUploadPath(file);
  const auth = await authHeader();

  if (path === "multipart") {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("job_id", jobId);
    fd.append("preset", options.preset);
    if (options.language) fd.append("language", options.language);
    if (options.num_speakers != null) fd.append("num_speakers", String(options.num_speakers));
    fd.append("diarize", String(options.diarize));
    const res = await fetch(`${env.NEXT_PUBLIC_BACKEND_URL}/jobs`, {
      method: "POST",
      headers: auth,
      body: fd,
    });
    if (!res.ok) {
      throw new Error(`POST /jobs failed: ${res.status} ${res.statusText}`);
    }
    return { jobId };
  }

  // TUS path — auth header attached to upload-creation request ONLY.
  // TUS PATCH chunk requests do NOT include Authorization (spec: auth established
  // at upload-creation; chunks ride the tus-uploadId).
  const handle = startTusUpload(
    file,
    `${env.NEXT_PUBLIC_BACKEND_URL}/uploads`,
    handlers,
    {
      // Pass options as TUS metadata so the backend can create the job
      // row when the chunked upload completes.
      job_id: jobId,
      preset: options.preset,
      language: options.language ?? "",
      num_speakers: options.num_speakers != null ? String(options.num_speakers) : "",
      diarize: String(options.diarize),
    },
    auth,
  );
  return { jobId, uploadHandle: handle };
}
