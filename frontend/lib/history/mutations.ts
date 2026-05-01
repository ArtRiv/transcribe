"use server";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Rename writes to BOTH `transcripts` (when a row exists for this job)
 * and `jobs.options.title`, so the title persists through any future
 * jobs→transcripts re-ingest and survives even when the transcripts row
 * is missing (anonymous completions). The `id` arg is a jobs.id —
 * see lib/history/queries.ts for the rationale.
 */
export async function renameTranscript(
  id: string,
  title: string,
): Promise<Result> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return { ok: false, error: "Title required" };
  const supabase = await getSupabaseServerClient();

  const { data: jobRow, error: jobReadErr } = await supabase
    .from("jobs")
    .select("transcript_id, options")
    .eq("id", id)
    .maybeSingle();
  if (jobReadErr) return { ok: false, error: jobReadErr.message };

  // Patch jobs.options.title — the keep-the-edit-even-if-no-transcripts-row layer.
  const nextOptions = { ...(jobRow?.options ?? {}), title: cleanTitle };
  const { error: jobUpdateErr } = await supabase
    .from("jobs")
    .update({ options: nextOptions })
    .eq("id", id);
  if (jobUpdateErr) return { ok: false, error: jobUpdateErr.message };

  // Best-effort transcripts row update; failures here are non-fatal.
  if (jobRow?.transcript_id) {
    await supabase
      .from("transcripts")
      .update({ title: cleanTitle, updated_at: new Date().toISOString() })
      .eq("id", jobRow.transcript_id);
  }

  revalidatePath("/history");
  return { ok: true };
}

/**
 * Delete the jobs row by id. The `transcripts` row (if any) is left in
 * place because the FK is ON DELETE SET NULL on jobs.transcript_id rather
 * than the other direction; cleaning orphaned transcripts is a separate
 * Phase 5 task. From the user's POV the row disappears from /history
 * immediately, which is what they want — and the editor at /job/[id]
 * stops resolving since jobs.id is the lookup key.
 */
export async function deleteTranscript(id: string): Promise<Result> {
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from("jobs").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/history");
  return { ok: true };
}
