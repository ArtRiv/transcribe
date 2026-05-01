import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// Transcribe.html lines 281-291 (.select) — native select with chevron overlay
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** When true, the wrapper expands to fill its parent flex/grid track and
   *  the inner <select> is clamped with text-overflow: ellipsis so a long
   *  selected option label cannot push past its container. */
  fullWidth?: boolean;
}

function Select({ className, children, fullWidth, ...props }: SelectProps) {
  return (
    <div
      className={cn(
        "relative",
        fullWidth ? "flex w-full min-w-0" : "inline-flex",
      )}
    >
      <select
        data-slot="select"
        className={cn(
          "h-[34px] pl-3 pr-8 bg-(--color-bg-2) border border-(--color-line)",
          "text-(--color-fg-1) text-sm appearance-none",
          "rounded-(--radius-md) outline-none transition-colors",
          "focus:border-(--color-accent-line)",
          "disabled:opacity-50",
          fullWidth && "w-full min-w-0 truncate",
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
