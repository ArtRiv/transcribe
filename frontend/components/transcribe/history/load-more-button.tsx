"use client";
import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/i18n-context";

interface LoadMoreButtonProps {
  cursor: string;
}

/**
 * Static "Load more" button for pagination (D-12).
 * D-12: static button only — no infinite scroll via observer API.
 */
export function LoadMoreButton({ cursor }: LoadMoreButtonProps) {
  const { t } = useI18n();
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
      aria-label={t.history_load_more}
    >
      {loading ? "…" : t.history_load_more}
    </Button>
  );
}
