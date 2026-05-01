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
  language?: string; // BCP-47 short code, omitted for auto-detect
  num_speakers?: number; // 0 = auto, otherwise pinned count
  diarize: boolean;
  /** Specific whisper.cpp model to use, overriding the preset.
   *  Quick task 260501-1e4 (item line 15 of Things-to-change.txt) lands the
   *  Advanced sub-accordion + UI surface; the value is forwarded to the
   *  backend in BOTH the multipart formdata and TUS metadata under key
   *  "model" so a future backend change can honor it without a frontend
   *  redeploy. The backend in this commit treats the field as a no-op. */
  model?: string;
}

/** Decision branch — exposed for Vitest coverage (CORE-04 acceptance). */
export function decideUploadPath(file: { size: number }): "multipart" | "tus" {
  return file.size < SMALL_PATH_LIMIT ? "multipart" : "tus";
}

export interface SubmitJobResult {
  jobId: string;
  uploadHandle?: Upload; // present only for TUS path; caller can call .abort()
}

/** Discrete failure modes the page reducer maps to localized titles + bodies.
 *  Item line 19 of Things-to-change.txt: "Im not running the backend locally
 *  ... it showed me an error message but its too vague". The kinds below are
 *  i18n-agnostic codes so the React tree can look up titles via t.err_*. */
export type SubmitErrorKind =
  | "backend-unreachable" // network-level: TypeError on fetch, DNS, ECONNREFUSED, 5xx with no body
  | "upload-failed" // TUS rejected
  | "auth-failed" // 401/403 from /jobs
  | "validation-failed" // 400 with a structured detail
  | "unknown";

export class SubmitError extends Error {
  constructor(
    public readonly kind: SubmitErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SubmitError";
  }
}

/** Best-effort mapping for opaque tus-js-client / fetch errors. The TUS client
 *  fires onError with a generic Error whose message is the only signal. */
export function classifyUploadError(err: unknown): SubmitErrorKind {
  if (err instanceof SubmitError) return err.kind;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    lower.includes("fetch failed") ||
    lower.includes("failed to fetch") ||
    lower.includes("network") ||
    lower.includes("econnrefused") ||
    lower.includes("err_connection")
  ) {
    return "backend-unreachable";
  }
  if (
    lower.includes(" 401") ||
    lower.includes(" 403") ||
    lower.includes("unauthor")
  ) {
    return "auth-failed";
  }
  return "upload-failed";
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
    // num_speakers: 0 in the UI = "Auto" (per JobOptions doc above).
    // The backend's Pydantic schema requires ge=1 OR null, so we MUST omit
    // the field entirely when 0 — sending "0" produces a 400.
    if (options.num_speakers != null && options.num_speakers > 0) {
      fd.append("num_speakers", String(options.num_speakers));
    }
    fd.append("diarize", String(options.diarize));
    // Optional model override (Advanced sub-accordion). Sent only if set so
    // backends that don't yet recognize the field stay on the preset path.
    if (options.model) fd.append("model", options.model);
    let res: Response;
    try {
      res = await fetch(`${env.NEXT_PUBLIC_BACKEND_URL}/jobs`, {
        method: "POST",
        headers: auth,
        body: fd,
      });
    } catch (err) {
      // TypeError on fetch in the browser = network-level failure (DNS,
      // ECONNREFUSED, CORS preflight blocked, tunnel down). The user's
      // session that produced item line 19 of Things-to-change.txt was
      // exactly this case: backend not running.
      throw new SubmitError(
        "backend-unreachable",
        err instanceof Error ? err.message : String(err),
        err,
      );
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new SubmitError("auth-failed", `${res.status} ${res.statusText}`);
      }
      if (res.status >= 500) {
        throw new SubmitError(
          "backend-unreachable",
          `${res.status} ${res.statusText}`,
        );
      }
      if (res.status === 400) {
        const body = await res.text().catch(() => "");
        throw new SubmitError(
          "validation-failed",
          body || `${res.status} ${res.statusText}`,
        );
      }
      throw new SubmitError("unknown", `${res.status} ${res.statusText}`);
    }
    return { jobId };
  }

  // TUS path — auth header attached to upload-creation request ONLY.
  // TUS PATCH chunk requests do NOT include Authorization (spec: auth established
  // at upload-creation; chunks ride the tus-uploadId).
  //
  // Wrap the caller-supplied onError so consumers receive a typed SubmitError
  // (Item line 19 — vague messages were the user-reported problem).
  const wrappedHandlers: UploadHandlers = {
    ...handlers,
    onError: (err) => {
      const kind = classifyUploadError(err);
      const wrapped =
        err instanceof SubmitError
          ? err
          : new SubmitError(
              kind,
              err instanceof Error ? err.message : String(err),
              err,
            );
      handlers.onError(wrapped);
    },
  };
  const handle = startTusUpload(
    file,
    `${env.NEXT_PUBLIC_BACKEND_URL}/uploads`,
    wrappedHandlers,
    {
      // Pass options as TUS metadata so the backend can create the job
      // row when the chunked upload completes.
      job_id: jobId,
      preset: options.preset,
      language: options.language ?? "",
      // 0 = Auto → empty string so the backend's TUS metadata parser treats
      // it as absent (mirrors the multipart path above).
      num_speakers:
        options.num_speakers != null && options.num_speakers > 0
          ? String(options.num_speakers)
          : "",
      diarize: String(options.diarize),
      model: options.model ?? "",
    },
    auth,
  );
  return { jobId, uploadHandle: handle };
}
