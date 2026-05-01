"use client";
import * as React from "react";
import { Search } from "lucide-react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/i18n-context";

interface HistorySearchProps {
  initialValue?: string;
}

/**
 * Title-only ILIKE search for the history page (D-12).
 * 300ms debounced; updates ?q= URL param via router.replace.
 */
export function HistorySearch({ initialValue = "" }: HistorySearchProps) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(initialValue);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (next) {
        params.set("q", next);
      } else {
        params.delete("q");
      }
      // Reset cursor when searching
      params.delete("cursor");
      router.replace(`${pathname}?${params.toString()}`);
    }, 300);
  }

  return (
    <div className="relative" style={{ width: 240 }}>
      <Search
        size={14}
        aria-hidden
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--color-fg-3) pointer-events-none"
      />
      <input
        type="search"
        value={value}
        onChange={handleChange}
        placeholder={t.history_search_placeholder}
        aria-label={t.history_search_placeholder}
        className="w-full pl-8 pr-3 py-1.5 text-sm bg-(--color-bg-2) border border-(--color-line) rounded-(--radius-md) text-(--color-fg-0) placeholder:text-(--color-fg-4) focus:outline-none focus:border-(--color-accent)"
      />
    </div>
  );
}
