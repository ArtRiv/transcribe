"use client";
import { Tooltip } from "@base-ui/react/tooltip";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Tooltip wrapper around @base-ui/react/tooltip.
 * Replaces the spec's CSS-only `.tip[data-tip]:hover::after` (Transcribe.html lines 358-372)
 * which lacks keyboard accessibility (no aria-describedby, no focus support).
 * Base UI handles aria-describedby, hover/focus triggers, escape, dismissal.
 */
function TooltipProvider(props: Tooltip.Provider.Props) {
  return <Tooltip.Provider delay={150} closeDelay={100} {...props} />;
}

function TooltipRoot(props: Tooltip.Root.Props) {
  return <Tooltip.Root {...props} />;
}

function TooltipTrigger(props: Tooltip.Trigger.Props) {
  return <Tooltip.Trigger {...props} />;
}

function TooltipPanel({
  className,
  children,
  ...props
}: Tooltip.Popup.Props) {
  return (
    <Tooltip.Portal>
      <Tooltip.Positioner sideOffset={6}>
        <Tooltip.Popup
          data-slot="tooltip-popup"
          className={cn(
            "px-2 py-1 bg-(--color-bg-3) border border-(--color-line)",
            "text-(--color-fg-1) text-[11.5px] rounded-(--radius-sm)",
            "shadow-[0_4px_12px_rgba(0,0,0,0.3)]",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "transition-opacity duration-150",
            className,
          )}
          {...props}
        >
          {children}
        </Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  );
}

export {
  TooltipProvider as Provider,
  TooltipRoot as Root,
  TooltipTrigger as Trigger,
  TooltipPanel as Panel,
};
