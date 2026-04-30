import * as React from "react";

import { cn } from "@/lib/utils";

// Transcribe.html lines 281-291 (.input)
function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      data-slot="input"
      className={cn(
        "h-[34px] px-3 bg-(--color-bg-2) border border-(--color-line)",
        "text-(--color-fg-1) text-sm placeholder:text-(--color-fg-3)",
        "rounded-(--radius-md) outline-none transition-colors",
        "focus:border-(--color-accent-line)",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
