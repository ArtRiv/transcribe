import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Variants per Transcribe.html lines 134-161 (.btn / .btn-primary / .btn-ghost / .btn-icon / .btn-sm)
const buttonVariants = cva(
  [
    // base — Transcribe.html lines 135-147
    "inline-flex items-center justify-center whitespace-nowrap select-none",
    "rounded-(--radius-md) transition-all duration-150 outline-none",
    "text-[13px] font-medium leading-none",
    "disabled:opacity-50 disabled:pointer-events-none",
    "focus-visible:outline-2 focus-visible:outline-(--color-accent) focus-visible:outline-offset-2",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[14px]",
  ].join(" "),
  {
    variants: {
      variant: {
        // .btn — Transcribe.html lines 135-147
        default:
          "bg-(--color-bg-3) text-(--color-fg-1) border border-(--color-line) hover:bg-(--color-bg-4)",
        // .btn-primary — Transcribe.html lines 148-154
        primary:
          "bg-(--color-accent) text-[oklch(0.20_0.020_70)] font-semibold hover:bg-(--color-accent-2) border border-transparent",
        // .btn-ghost — Transcribe.html lines 158-159
        ghost:
          "bg-transparent text-(--color-fg-1) border border-transparent hover:bg-(--color-bg-3) hover:border-(--color-line-soft)",
      },
      size: {
        default: "h-8 px-3 gap-1.5",     // 32 px — line 137
        sm: "h-[26px] px-2 gap-1",       // line 161 — sub-grid intentional
        icon: "size-8 p-0",              // line 160
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
