"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { TranscriptCard } from "@/components/transcribe/history/transcript-card";
import { HistorySearch } from "@/components/transcribe/history/history-search";
import { HistoryEmpty } from "@/components/transcribe/history/history-empty";
import { LoadMoreButton } from "@/components/transcribe/history/load-more-button";
import {
  renameTranscript,
  deleteTranscript,
} from "@/lib/history/mutations";
import type { TranscriptListItem } from "@/lib/history/queries";

interface State {
  rows: TranscriptListItem[];
  pendingDelete: Set<string>; // optimistic-removed ids
}

type Action =
  | { type: "set"; rows: TranscriptListItem[] }
  | { type: "rename"; id: string; title: string }
  | { type: "delete-optimistic"; id: string }
  | { type: "delete-undo"; id: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set":
      return { rows: action.rows, pendingDelete: new Set() };
    case "rename":
      return {
        ...state,
        rows: state.rows.map((r) =>
          r.id === action.id ? { ...r, title: action.title } : r,
        ),
      };
    case "delete-optimistic": {
      const next = new Set(state.pendingDelete);
      next.add(action.id);
      return { ...state, pendingDelete: next };
    }
    case "delete-undo": {
      const next = new Set(state.pendingDelete);
      next.delete(action.id);
      return { ...state, pendingDelete: next };
    }
  }
}

function Inner({
  initialRows,
  initialCursor,
  initialQuery,
}: {
  initialRows: TranscriptListItem[];
  initialCursor: string | null;
  initialQuery: string;
}) {
  const router = useRouter();
  const { show } = useToast();
  const [state, dispatch] = React.useReducer(reducer, {
    rows: initialRows,
    pendingDelete: new Set<string>(),
  });

  async function handleRename(id: string, title: string) {
    dispatch({ type: "rename", id, title }); // optimistic
    const res = await renameTranscript(id, title);
    if (!res.ok) {
      // revert via revalidate (server-truth refresh)
      router.refresh();
      show(`Rename failed: ${res.error}`, { variant: "error" });
    }
  }

  function handleDelete(id: string, title: string) {
    dispatch({ type: "delete-optimistic", id });
    let undone = false;
    show(`Deleted "${title}".`, {
      durationMs: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          dispatch({ type: "delete-undo", id });
        },
      },
    });
    // Commit on timeout (5s).
    setTimeout(async () => {
      if (undone) return;
      const res = await deleteTranscript(id);
      if (!res.ok) {
        dispatch({ type: "delete-undo", id });
        show(`Delete failed: ${res.error}`, { variant: "error" });
      } else {
        router.refresh(); // server truth — drop the row
      }
    }, 5000);
  }

  const visible = state.rows.filter((r) => !state.pendingDelete.has(r.id));
  if (visible.length === 0) return <HistoryEmpty variant="zero" />;

  return (
    <div className="mx-auto max-w-[1080px] px-8 pt-8 pb-12">
      <header className="mb-[22px] flex items-end justify-between gap-4">
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wider text-(--color-fg-3)">
            Your transcripts
          </div>
          <h1 className="font-serif text-[38px] leading-[1.05] tracking-tight">History</h1>
        </div>
        <HistorySearch initialValue={initialQuery} />
      </header>
      <div className="flex flex-col gap-3">
        {visible.map((row) => (
          <TranscriptCard
            key={row.id}
            transcript={row}
            onRename={(t) => handleRename(row.id, t)}
            onDelete={() => handleDelete(row.id, row.title ?? "Untitled")}
          />
        ))}
      </div>
      {initialCursor && (
        <div className="mt-6 flex justify-center">
          <LoadMoreButton cursor={initialCursor} />
        </div>
      )}
      <footer className="mt-10 text-center text-[11.5px] text-(--color-fg-4)">
        Stored in Supabase · synced via Realtime · click any row to open
      </footer>
    </div>
  );
}

export function HistoryClient(props: {
  initialRows: TranscriptListItem[];
  initialCursor: string | null;
  initialQuery: string;
}) {
  return (
    <ToastProvider>
      <Inner {...props} />
    </ToastProvider>
  );
}
