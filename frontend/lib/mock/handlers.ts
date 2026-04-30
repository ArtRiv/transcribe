// MSW request handlers — mirror backend/app/routes/.
//
// The handlers are registered ONLY in dev when NEXT_PUBLIC_USE_MOCKS=1
// (gated by app/(mock-init)/msw-init.tsx). In production the worker is
// never started, so these handlers are unreachable.
//
// [Cited: RESEARCH §Pattern 5; UI-SPEC §14.2]

import { http, HttpResponse } from "msw";
import {
  MAX_CHUNK,
  TUS_VERSION,
  createUpload,
  getUpload,
  advanceOffset,
  deleteUpload,
  parseUploadMetadata,
} from "./tus-state";
import { startMockJob, cancelMockJob } from "./realtime";

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

/** Headers required by TUS 1.0.0 protocol. */
const TUS_HEADERS = {
  "Tus-Resumable": TUS_VERSION,
  "Tus-Version": TUS_VERSION,
};

export const handlers = [
  // --- POST /jobs (multipart < 90 MB) ---
  http.post(`${BASE}/jobs`, async ({ request }) => {
    const fd = await request.formData();
    const job_id =
      (fd.get("job_id") as string | null) ?? crypto.randomUUID();
    const preset = (fd.get("preset") as string | null) ?? "average";
    const language = fd.get("language") as string | null;
    const num_speakersRaw = fd.get("num_speakers") as string | null;
    const num_speakers = num_speakersRaw ? parseInt(num_speakersRaw, 10) : null;
    const diarize = (fd.get("diarize") as string | null) !== "false";

    // Fire the Realtime stub timeline.
    startMockJob(job_id);

    return HttpResponse.json(
      { job_id, status: "queued", preset, language, num_speakers, diarize },
      { status: 202 },
    );
  }),

  // --- DELETE /jobs/{id} (cancel) ---
  http.delete(`${BASE}/jobs/:id`, ({ params }) => {
    const id = params.id as string;
    cancelMockJob(id);
    return new HttpResponse(null, { status: 202 });
  }),

  // --- GET /healthz ---
  http.get(`${BASE}/healthz`, () => {
    return HttpResponse.json({ status: "ok" });
  }),

  // --- GET /readyz ---
  http.get(`${BASE}/readyz`, () => {
    return HttpResponse.json({
      status: "ready",
      presets_available: ["fast", "average", "average_turbo"],
      vulkan_device: "Mock GPU",
    });
  }),

  // --- TUS /uploads (CORS preflight + protocol probe) ---
  http.options(`${BASE}/uploads`, () => {
    return new HttpResponse(null, {
      status: 204,
      headers: {
        ...TUS_HEADERS,
        "Tus-Extension": "creation,termination",
        "Tus-Max-Size": String(5 * 1024 * 1024 * 1024), // 5 GiB
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),

  // --- POST /uploads (TUS creation) ---
  http.post(`${BASE}/uploads`, ({ request }) => {
    const length =
      parseInt(request.headers.get("Upload-Length") ?? "0", 10) || 0;
    const metadata = parseUploadMetadata(request.headers.get("Upload-Metadata"));
    const uploadId = crypto.randomUUID();
    createUpload(uploadId, length, metadata);

    // If the metadata carries a job_id (set by lib/job/submit.ts TUS path),
    // the Realtime timeline is deferred until upload completes (PATCH below).
    return new HttpResponse(null, {
      status: 201,
      headers: { ...TUS_HEADERS, Location: `${BASE}/uploads/${uploadId}` },
    });
  }),

  // --- HEAD /uploads/{id} ---
  http.head(`${BASE}/uploads/:id`, ({ params }) => {
    const u = getUpload(params.id as string);
    if (!u) return new HttpResponse(null, { status: 404, headers: TUS_HEADERS });
    return new HttpResponse(null, {
      status: 204,
      headers: {
        ...TUS_HEADERS,
        "Upload-Offset": String(u.offset),
        "Upload-Length": String(u.length),
        "Cache-Control": "no-store",
      },
    });
  }),

  // --- PATCH /uploads/{id} (chunk upload) ---
  http.patch(`${BASE}/uploads/:id`, async ({ params, request }) => {
    const id = params.id as string;
    const u = getUpload(id);
    if (!u) return new HttpResponse(null, { status: 404, headers: TUS_HEADERS });

    const body = await request.arrayBuffer();
    const chunkBytes = Math.min(body.byteLength, MAX_CHUNK);

    // Simulate network latency per UI-SPEC §14.6 (200-500 ms per chunk).
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));

    const newOffset = advanceOffset(id, chunkBytes);
    const upload = getUpload(id)!;

    // On completion, kick off the Realtime timeline using job_id from metadata.
    if (upload.completed && upload.metadata.job_id) {
      startMockJob(upload.metadata.job_id);
    }

    return new HttpResponse(null, {
      status: 204,
      headers: {
        ...TUS_HEADERS,
        "Upload-Offset": String(newOffset),
      },
    });
  }),

  // --- DELETE /uploads/{id} (TUS termination) ---
  http.delete(`${BASE}/uploads/:id`, ({ params }) => {
    deleteUpload(params.id as string);
    return new HttpResponse(null, { status: 204, headers: TUS_HEADERS });
  }),
];
