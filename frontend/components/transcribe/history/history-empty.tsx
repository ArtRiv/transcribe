import * as React from "react";
import Link from "next/link";

interface HistoryEmptyProps {
  /** "signed-out" = no user (anonymous or not logged in); "zero" = signed in, no transcripts yet */
  variant: "signed-out" | "zero";
}

/**
 * Empty state for /history.
 * D-03: signed-out → hint about user button only; NO separate sign-in card (D-01 — no OAuth buttons).
 */
export function HistoryEmpty({ variant }: HistoryEmptyProps) {
  if (variant === "signed-out") {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="text-sm text-(--color-fg-3)">
          Sign in via the user button (top right) to see your transcripts.
        </p>
      </div>
    );
  }

  // variant === "zero" — signed in but no transcripts yet
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <p className="text-sm text-(--color-fg-3) mb-4">No transcripts yet.</p>
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-(--color-accent) hover:underline"
      >
        + New transcript
      </Link>
    </div>
  );
}
