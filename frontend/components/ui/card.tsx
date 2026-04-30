import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// Transcribe.html lines 274-278 (.card)
const cardVariants = cva(
  "bg-(--color-bg-2) border border-(--color-line) rounded-(--radius-lg)",
);

function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof cardVariants>) {
  return <div data-slot="card" className={cn(cardVariants(), className)} {...props} />;
}

export { Card, cardVariants };
