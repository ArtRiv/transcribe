"use client";
import * as React from "react";

import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
  className?: string;
}

/**
 * Custom switch (D-09) — design behavior differs from shadcn.
 * Spec: Transcribe.html lines 294-311 (.sw[data-on="true"]).
 * Track 32×18 px (sub-grid intentional per UI-SPEC §2); thumb 14×14 px slides 14 px on toggle.
 */
function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...rest
}: SwitchProps) {
  const toggle = React.useCallback(() => {
    if (!disabled) onCheckedChange(!checked);
  }, [checked, disabled, onCheckedChange]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-on={checked ? "true" : "false"}
      data-slot="switch"
      disabled={disabled}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggle();
        }
      }}
      className={cn(
        "relative inline-flex shrink-0 items-center cursor-pointer transition-all duration-150",
        "rounded-full border outline-none",
        "focus-visible:outline-2 focus-visible:outline-(--color-accent) focus-visible:outline-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "data-[on=false]:bg-(--color-bg-4) data-[on=false]:border-(--color-line)",
        "data-[on=true]:bg-(--color-accent) data-[on=true]:border-transparent",
        className,
      )}
      style={{ width: 32, height: 18 }}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1/2 -translate-y-1/2 rounded-full transition-all duration-150",
          "bg-(--color-fg-0)",
        )}
        style={{
          width: 14,
          height: 14,
          left: checked ? 16 : 2, // 32 - 14 - 2 = 16 (right pad 2 px)
        }}
      />
    </button>
  );
}

export { Switch };
