import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getTranscripts } from "@/lib/history/queries";
import { HistoryClient } from "./history-client";
import { HistoryEmpty } from "@/components/transcribe/history/history-empty";

/**
 * /history RSC — Plan 04-07.
 * D-03: signed-out or anonymous → show hint pointing to user button; NO sign-in card.
 * D-12: ILIKE title search via ?q=; cursor pagination via ?cursor=.
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}) {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // D-03: signed-out (no user OR anonymous) → empty state hint, NO sign-in card.
  if (!user || user.is_anonymous) {
    return <HistoryEmpty variant="signed-out" />;
  }

  const sp = await searchParams;
  const { rows, nextCursor } = await getTranscripts({
    q: sp.q ?? "",
    cursor: sp.cursor ?? null,
  });

  return (
    <HistoryClient
      initialRows={rows}
      initialCursor={nextCursor}
      initialQuery={sp.q ?? ""}
    />
  );
}
