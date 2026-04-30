"use client";
// Frontend client-side promote action (04-08 D-08).
// Routes the promotion call through FastAPI (service-role path) per
// RESEARCH Open Question 1 recommendation — avoids the RLS UPDATE-policy
// mismatch that a direct Supabase call would hit.
//
// T-04-05 mitigation: the caller MUST supply the previously-captured anon
// JWT (held in a ref since before the magic-link redirect) as `previousAnonToken`.
// FastAPI verifies both JWTs and checks sub-ownership of the source job.
//
// [Cited: 04-RESEARCH.md §Open Question 1; 04-PATTERNS.md promote.ts row]

import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { env } from "@/lib/env";

export interface PromoteArgs {
  jobId: string;
  /** The anon JWT captured BEFORE the magic-link redirect. */
  previousAnonToken: string;
  payload: unknown;
  title: string;
  source_filename: string;
  duration_sec?: number;
  language?: string | null;
  model_used?: string | null;
  diarized?: boolean | null;
}

export type PromoteResult =
  | { ok: true; transcriptId: string }
  | { ok: false; error: string };

/**
 * Promote an anonymous job to the currently signed-in user's account.
 *
 * Calls FastAPI POST /jobs/{jobId}/promote with:
 *   - Authorization: Bearer <signed-in access_token>
 *   - X-Previous-Anon-Token: <previousAnonToken>
 *
 * FastAPI verifies both JWTs, confirms ownership, inserts a transcripts row,
 * and re-owns the jobs row to the signed-in user's identity (D-08).
 */
export async function promoteAnonJob(args: PromoteArgs): Promise<PromoteResult> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, error: "Not signed in" };
  }

  const url = `${env.NEXT_PUBLIC_BACKEND_URL}/jobs/${encodeURIComponent(args.jobId)}/promote`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        "X-Previous-Anon-Token": args.previousAnonToken,
      },
      body: JSON.stringify({
        payload: args.payload,
        title: args.title,
        source_filename: args.source_filename,
        duration_sec: args.duration_sec ?? null,
        language: args.language ?? null,
        model_used: args.model_used ?? null,
        diarized: args.diarized ?? null,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `${res.status}: ${detail || res.statusText}` };
    }
    const data = (await res.json()) as { transcript_id: string };
    return { ok: true, transcriptId: data.transcript_id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}
