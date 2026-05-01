import { getSupabaseServerClient } from "@/lib/supabase/server";

export interface TranscriptListItem {
  /** This is the jobs.id — the route at /job/[id] reads jobs.transcript_payload,
   *  so linking by transcripts.id was the original bug (it produced a 404
   *  loop where the page mounted with no payload). */
  id: string;
  title: string | null;
  created_at: string;
  duration_sec: number | null;
  language: string | null;
  diarized: boolean | null;
}

export const HISTORY_PAGE_SIZE = 20;

interface JobRow {
  id: string;
  source_filename: string | null;
  created_at: string;
  transcript_payload: { duration_sec?: number; language?: string } | null;
  options: { language?: string; diarize?: boolean; title?: string } | null;
  transcripts:
    | {
        title: string | null;
        duration_sec: number | null;
        language: string | null;
        diarized: boolean | null;
      }
    | {
        title: string | null;
        duration_sec: number | null;
        language: string | null;
        diarized: boolean | null;
      }[]
    | null;
}

function pickTranscript(row: JobRow["transcripts"]) {
  if (!row) return null;
  if (Array.isArray(row)) return row[0] ?? null;
  return row;
}

/**
 * History is sourced from `public.jobs` rather than `public.transcripts`.
 *
 * The original implementation read from `transcripts` only, which left the
 * list empty whenever:
 *  - a job was completed while the user was anonymous (worker skips the
 *    transcripts INSERT — see backend/app/queue/progress.py CORE-08), or
 *  - the transcripts INSERT failed silently (e.g. RLS regression, schema
 *    drift) and only the jobs UPDATE landed.
 *
 * Jobs is the strict superset: every successful run produces a jobs row
 * with `transcript_payload`, regardless of auth state. We left-join the
 * matching transcripts row (when present) for its richer metadata
 * (renamed title, normalized language, diarization flag), and fall back
 * to fields stored on the jobs row otherwise.
 *
 * Item 13 of "things to change 2.txt".
 */
export async function getTranscripts(args: {
  q?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ rows: TranscriptListItem[]; nextCursor: string | null }> {
  const supabase = await getSupabaseServerClient();
  const limit = args.limit ?? HISTORY_PAGE_SIZE;
  let query = supabase
    .from("jobs")
    .select(
      "id, source_filename, created_at, transcript_payload, options, transcripts:transcript_id(title, duration_sec, language, diarized)",
    )
    .eq("status", "succeeded")
    .not("transcript_payload", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (args.q) query = query.ilike("source_filename", `%${args.q}%`);
  if (args.cursor) query = query.lt("created_at", args.cursor);
  const { data, error } = await query;
  if (error) throw error;
  const jobs = (data ?? []) as JobRow[];
  const hasMore = jobs.length > limit;
  const trimmed = hasMore ? jobs.slice(0, limit) : jobs;
  const rows: TranscriptListItem[] = trimmed.map((j) => {
    const tr = pickTranscript(j.transcripts);
    return {
      id: j.id,
      title: tr?.title ?? j.options?.title ?? j.source_filename ?? null,
      created_at: j.created_at,
      duration_sec:
        tr?.duration_sec ?? j.transcript_payload?.duration_sec ?? null,
      language:
        tr?.language ??
        j.transcript_payload?.language ??
        j.options?.language ??
        null,
      diarized: tr?.diarized ?? j.options?.diarize ?? null,
    };
  });
  const nextCursor = hasMore ? rows[rows.length - 1].created_at : null;
  return { rows, nextCursor };
}
