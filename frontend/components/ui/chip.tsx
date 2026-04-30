import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Transcribe.html lines 122-132 (.chip + .chip-dot)
const chipVariants = cva(
  [
    "inline-flex items-center gap-1.5 px-2.5 py-1",
    "bg-(--color-bg-2) border border-(--color-line) rounded-full",
    "text-[11.5px] text-(--color-fg-2) font-mono",
  ].join(" "),
);

interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {
  /** Optional colored dot (used for status pills + speaker chips). Pass an oklch color or var(--color-...) string. */
  dotColor?: string;
}

function Chip({ className, dotColor, children, ...props }: ChipProps) {
  return (
    <span data-slot="chip" className={cn(chipVariants(), className)} {...props}>
      {dotColor ? (
        <span
          aria-hidden="true"
          className="inline-block rounded-full"
          style={{ width: 7, height: 7, background: dotColor }}
        />
      ) : null}
      {children}
    </span>
  );
}

export { Chip, chipVariants };
