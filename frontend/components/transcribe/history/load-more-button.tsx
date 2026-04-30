"use client";
import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

interface LoadMoreButtonProps {
  cursor: string;
}

/**
 * Static "Load more" button for pagination (D-12).
 * D-12: static button only — no infinite scroll via observer API.
 */
export function LoadMoreButton({ cursor }: LoadMoreButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = React.useState(false);

  function handleLoadMore() {
    setLoading(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set("cursor", cursor);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <Button
      variant="default"
      size="sm"
      onClick={handleLoadMore}
      disabled={loading}
      aria-label="Load more transcripts"
    >
      {loading ? "Loading…" : "Load more"}
    </Button>
  );
}
