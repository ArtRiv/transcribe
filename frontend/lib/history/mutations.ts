"use server";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

export async function renameTranscript(id: string, title: string): Promise<Result> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return { ok: false, error: "Title required" };
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("transcripts")
    .update({ title: cleanTitle, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/history");
  return { ok: true };
}

export async function deleteTranscript(id: string): Promise<Result> {
  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from("transcripts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/history");
  return { ok: true };
}
