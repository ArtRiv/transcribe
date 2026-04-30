"use client";
import * as React from "react";

import { cn } from "@/lib/utils";

interface SegmentedOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  hint?: string;
  disabled?: boolean;
}

interface SegmentedProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  "aria-label"?: string;
  className?: string;
  size?: "default" | "sm";
}

/**
 * Custom segmented control (D-09).
 * Spec: Transcribe.html lines 314-338 (.seg / .seg-opt.on).
 * ARIA: role="radiogroup" with per-option role="radio" + aria-checked.
 * Keyboard: arrow Left/Right cycles selection (UI-SPEC §12.4).
 */
function Segmented<T extends string = string>({
  options,
  value,
  onValueChange,
  className,
  size = "default",
  ...rest
}: SegmentedProps<T>) {
  const idx = options.findIndex((o) => o.value === value);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = (idx + 1) % options.length;
      onValueChange(options[next].value);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = (idx - 1 + options.length) % options.length;
      onValueChange(options[prev].value);
    }
  };

  return (
    <div
      role="radiogroup"
      data-slot="segmented"
      onKeyDown={onKeyDown}
      className={cn(
        "inline-flex items-center gap-0.5 p-0.5",
        "bg-(--color-bg-2) border border-(--color-line) rounded-(--radius-md)",
        className,
      )}
      {...rest}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={typeof opt.label === "string" ? opt.label : opt.value}
            disabled={opt.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(opt.value)}
            title={opt.hint}
            className={cn(
              "px-3 py-1 transition-all duration-150",
              "text-[12px] font-medium rounded-[8px]",
              "outline-none focus-visible:outline-2 focus-visible:outline-(--color-accent)",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              selected
                ? "bg-(--color-bg-3) text-(--color-fg-0) shadow-[0_1px_2px_rgba(0,0,0,0.25)]"
                : "text-(--color-fg-2) hover:text-(--color-fg-1)",
              size === "sm" && "px-2 py-0.5 text-[11.5px]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export { Segmented };
export type { SegmentedOption, SegmentedProps };
