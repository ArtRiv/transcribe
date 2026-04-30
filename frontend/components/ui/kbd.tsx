import * as React from "react";

import { cn } from "@/lib/utils";

// Transcribe.html lines 113-121 (.kbd)
function Kbd({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1",
        "bg-(--color-bg-3) border border-(--color-line) rounded-(--radius-sm)",
        "font-mono text-[10.5px] font-normal leading-none text-(--color-fg-2)",
        "shadow-[0_1px_0_rgba(0,0,0,0.3)]",
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}

export { Kbd };
