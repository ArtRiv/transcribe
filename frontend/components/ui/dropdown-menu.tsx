"use client";
// Dropdown menu primitive — wraps @base-ui/react Menu.
// UI-SPEC §8.1 Phase 4 NEW primitive.
// [Cited: 04-PATTERNS.md "dropdown-menu.tsx" row; 04-UI-SPEC §8.1]
import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

/** Re-export @base-ui/react Menu.Root as DropdownMenu for naming consistency. */
export const DropdownMenu = Menu.Root;

/** Re-export Menu.Trigger directly — callers use `render` prop to supply a custom button. */
export const DropdownMenuTrigger = Menu.Trigger;

/** Re-export Menu.Portal — caller wraps Positioner + Popup in this. */
export const DropdownMenuPortal = Menu.Portal;

/** Re-export Menu.Positioner — handles anchor positioning + sideOffset. */
export const DropdownMenuPositioner = Menu.Positioner;

/**
 * Styled Menu.Popup. Applies design-system surface tokens.
 * [Cited: 04-UI-SPEC §8.1; app.jsx:132-171 port]
 */
export const DropdownMenuPopup = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Menu.Popup>
>(({ className, ...props }, ref) => (
  <Menu.Popup
    ref={ref}
    className={cn(
      "min-w-[180px] rounded-[10px] bg-(--color-bg-2) p-1",
      "border border-(--color-line) shadow-[0_14px_36px_rgba(0,0,0,0.45)]",
      "outline-none",
      // Fade in on open (UI-SPEC §7)
      "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 transition-opacity duration-[240ms]",
      className,
    )}
    {...props}
  />
));
DropdownMenuPopup.displayName = "DropdownMenuPopup";

/**
 * Styled Menu.Item. Supports `variant='destructive'` for `--err` text color.
 * [Cited: 04-UI-SPEC §4.4 — destructive items (Sign out) are NOT styled err by default]
 */
export const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof Menu.Item> & {
    variant?: "default" | "destructive";
  }
>(({ className, variant = "default", ...props }, ref) => (
  <Menu.Item
    ref={ref}
    className={cn(
      "flex items-center gap-2 px-2.5 py-2 rounded-[7px]",
      "text-sm font-medium cursor-pointer select-none",
      "data-[highlighted]:bg-(--color-bg-3)",
      "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed",
      variant === "destructive" && "text-(--color-err)",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";
