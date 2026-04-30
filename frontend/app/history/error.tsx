"use client";
import { Button } from "@/components/ui/button";

/**
 * Per-route error boundary for /history (D-22) — UI-SPEC §11.
 * Mounted automatically by Next.js when the RSC or any client island throws.
 */
export default function HistoryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <h2 className="font-serif text-2xl mb-3">Couldn&apos;t load your history.</h2>
      <p className="text-sm text-(--color-fg-3) mb-4">{error.message}</p>
      <Button variant="default" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
