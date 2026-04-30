import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// Transcribe.html lines 281-291 (.select) — native select with chevron overlay
function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative inline-flex">
      <select
        data-slot="select"
        className={cn(
          "h-[34px] pl-3 pr-8 bg-(--color-bg-2) border border-(--color-line)",
          "text-(--color-fg-1) text-sm appearance-none",
          "rounded-(--radius-md) outline-none transition-colors",
          "focus:border-(--color-accent-line)",
          "disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        size={14}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-(--color-fg-3) pointer-events-none"
      />
    </div>
  );
}

export { Select };
