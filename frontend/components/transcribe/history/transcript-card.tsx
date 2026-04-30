"use client";
import * as React from "react";
import { FileAudio, ExternalLink, Download, Trash2 } from "lucide-react";
import { EditableText } from "@/components/transcribe/editor/editable-text";
import type { TranscriptListItem } from "@/lib/history/queries";

interface TranscriptCardProps {
  transcript: TranscriptListItem;
  onRename: (title: string) => void;
  onDelete: () => void;
}

/** Format seconds → H:MM:SS or M:SS */
function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Format ISO date → "Apr 1, 2026" */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * History transcript row card.
 * Reuses EditableText (D-10 — no modifications to primitive).
 * Delete invokes onDelete; parent (history-client.tsx) handles toast + 5s timer (D-11).
 */
export function TranscriptCard({ transcript, onRename, onDelete }: TranscriptCardProps) {
  const title = transcript.title ?? "Untitled";

  return (
    <div
      data-slot="transcript-card"
      className="flex items-center gap-4 px-4 py-3 rounded-(--radius-lg) border border-(--color-line) bg-(--color-bg-1) hover:bg-(--color-bg-3) transition-colors"
    >
      {/* File icon */}
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 28,
          height: 28,
          background: "var(--color-bg-3)",
          border: "1px solid var(--color-line)",
          borderRadius: 6,
          color: "var(--color-accent)",
        }}
      >
        <FileAudio size={14} aria-hidden />
      </div>

      {/* Title (editable) */}
      <div className="flex-1 min-w-0">
        <EditableText
          text={title}
          onChange={onRename}
          ariaLabel="Transcript title"
          className="text-sm font-medium text-(--color-fg-0) truncate"
        />
        <div className="text-[11.5px] text-(--color-fg-3) mono mt-0.5 flex items-center gap-2">
          {transcript.duration_sec != null && (
            <span>{fmtDuration(transcript.duration_sec)}</span>
          )}
          {transcript.language && (
            <span className="uppercase">{transcript.language}</span>
          )}
          <span>{fmtDate(transcript.created_at)}</span>
        </div>
      </div>

      {/* Action icons */}
      <div className="flex items-center gap-1 shrink-0">
        <a
          href={`/job/${transcript.id}`}
          aria-label="Open transcript"
          className="p-1.5 rounded-(--radius-sm) text-(--color-fg-3) hover:text-(--color-fg-0) hover:bg-(--color-bg-3) transition-colors"
        >
          <ExternalLink size={15} aria-hidden />
        </a>
        <a
          href={`/job/${transcript.id}?export=1`}
          aria-label="Download transcript"
          className="p-1.5 rounded-(--radius-sm) text-(--color-fg-3) hover:text-(--color-fg-0) hover:bg-(--color-bg-3) transition-colors"
        >
          <Download size={15} aria-hidden />
        </a>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete transcript"
          className="p-1.5 rounded-(--radius-sm) text-(--color-fg-3) hover:text-(--color-err) hover:bg-(--color-bg-3) transition-colors cursor-pointer"
          style={{ background: "none", border: 0 }}
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </div>
    </div>
  );
}
