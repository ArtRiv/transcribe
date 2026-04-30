"use client";
import { Popover } from "@base-ui/react/popover";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Popover wrapper around @base-ui/react/popover.
 * Used by the reassign menu (editor.jsx lines 504-539) for keyboard accessibility.
 */
function PopoverRoot(props: Popover.Root.Props) {
  return <Popover.Root {...props} />;
}

function PopoverTrigger(props: Popover.Trigger.Props) {
  return <Popover.Trigger {...props} />;
}

function PopoverPanel({ className, children, ...props }: Popover.Popup.Props) {
  return (
    <Popover.Portal>
      <Popover.Positioner sideOffset={4}>
        <Popover.Popup
          data-slot="popover-panel"
          className={cn(
            "min-w-[200px] p-1 bg-(--color-bg-2) border border-(--color-line)",
            "rounded-(--radius-md) shadow-[0_12px_32px_rgba(0,0,0,0.4)]",
            "outline-none",
            "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
            "transition-opacity duration-150",
            className,
          )}
          {...props}
        >
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}

export {
  PopoverRoot as Root,
  PopoverTrigger as Trigger,
  PopoverPanel as Panel,
};
