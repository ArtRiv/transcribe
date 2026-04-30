"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

interface OptionRowProps {
  label: string;
  hint?: string;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Two-column option layout — port from landing.jsx lines 315-331.
 * Grid: 200px 1fr; opacity 0.55 when disabled (used when diarize=off → speakers row dim).
 */
export function OptionRow({
  label,
  hint,
  disabled,
  children,
  className,
}: OptionRowProps) {
  return (
    <div
      aria-disabled={disabled || undefined}
      className={cn(
        "grid items-center gap-4 transition-opacity duration-150",
        disabled && "opacity-55",
        className,
      )}
      style={{ gridTemplateColumns: "200px 1fr" }}
    >
      <div className="flex flex-col gap-0.5">
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            color: "var(--color-fg-1)",
          }}
        >
          {label}
        </span>
        {hint ? (
          <span
            style={{
              fontSize: 11.5,
              color: "var(--color-fg-3)",
              lineHeight: 1.4,
            }}
          >
            {hint}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}
