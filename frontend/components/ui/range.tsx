"use client";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Native <input type="range"> styled per Transcribe.html lines 341-356.
 * Pass-through props with token-driven track + thumb styling.
 */
interface RangeProps extends React.InputHTMLAttributes<HTMLInputElement> {
  valueText?: string; // ARIA aria-valuetext (e.g., "Auto" when value = 0)
}

function Range({ className, valueText, ...props }: RangeProps) {
  return (
    <input
      {...props}
      type="range"
      data-slot="range"
      aria-valuetext={valueText}
      className={cn(
        "appearance-none bg-transparent w-full h-5 outline-none",
        "[&::-webkit-slider-runnable-track]:h-1.5",
        "[&::-webkit-slider-runnable-track]:bg-(--color-bg-3)",
        "[&::-webkit-slider-runnable-track]:rounded-full",
        "[&::-webkit-slider-runnable-track]:border",
        "[&::-webkit-slider-runnable-track]:border-(--color-line)",
        "[&::-webkit-slider-thumb]:appearance-none",
        "[&::-webkit-slider-thumb]:size-4",
        "[&::-webkit-slider-thumb]:bg-(--color-accent)",
        "[&::-webkit-slider-thumb]:rounded-full",
        "[&::-webkit-slider-thumb]:border",
        "[&::-webkit-slider-thumb]:border-(--color-line)",
        "[&::-webkit-slider-thumb]:shadow-[0_1px_4px_rgba(0,0,0,0.4)]",
        "[&::-webkit-slider-thumb]:-mt-[5px]",
        "[&::-moz-range-track]:h-1.5",
        "[&::-moz-range-track]:bg-(--color-bg-3)",
        "[&::-moz-range-track]:rounded-full",
        "[&::-moz-range-thumb]:size-4",
        "[&::-moz-range-thumb]:bg-(--color-accent)",
        "[&::-moz-range-thumb]:rounded-full",
        "[&::-moz-range-thumb]:border",
        "[&::-moz-range-thumb]:border-(--color-line)",
        "focus-visible:outline-2 focus-visible:outline-(--color-accent) focus-visible:outline-offset-2",
        className,
      )}
    />
  );
}

export { Range };
