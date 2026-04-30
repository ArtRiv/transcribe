import { getSupabaseServerClient } from "@/lib/supabase/server";

export interface TranscriptListItem {
  id: string;
  title: string | null;
  created_at: string;
  duration_sec: number | null;
  language: string | null;
  diarized: boolean | null;
}

export const HISTORY_PAGE_SIZE = 20;

export async function getTranscripts(args: {
  q?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<{ rows: TranscriptListItem[]; nextCursor: string | null }> {
  const supabase = await getSupabaseServerClient();
  const limit = args.limit ?? HISTORY_PAGE_SIZE;
  let query = supabase
    .from("transcripts")
    .select("id, title, created_at, duration_sec, language, diarized")
    .order("created_at", { ascending: false })
    .limit(limit + 1); // +1 to detect hasMore
  if (args.q) query = query.ilike("title", `%${args.q}%`);
  if (args.cursor) query = query.lt("created_at", args.cursor);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as TranscriptListItem[];
  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? trimmed[trimmed.length - 1].created_at : null;
  return { rows: trimmed, nextCursor };
}
