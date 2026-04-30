"use client";
import { Dialog } from "@base-ui/react/dialog";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Dialog wrapper around @base-ui/react/dialog.
 * Used by the export modal (UI-SPEC §9.5) for focus trap, Escape, aria-modal.
 * Replaces the spec's hand-rolled overlay (export.jsx lines 86-110) which
 * lacks focus management.
 */
function DialogRoot(props: Dialog.Root.Props) {
  return <Dialog.Root {...props} />;
}

function DialogTrigger(props: Dialog.Trigger.Props) {
  return <Dialog.Trigger {...props} />;
}

function DialogBackdrop({ className, ...props }: Dialog.Backdrop.Props) {
  return (
    <Dialog.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        "fixed inset-0 z-[300] backdrop-blur-[8px]",
        "data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        "transition-opacity duration-200",
        className,
      )}
      style={{ background: "oklch(0.10 0.008 70 / 0.6)" }}
      {...props}
    />
  );
}

function DialogPanel({ className, children, ...props }: Dialog.Popup.Props) {
  return (
    <Dialog.Portal>
      <DialogBackdrop />
      <Dialog.Popup
        data-slot="dialog-panel"
        className={cn(
          "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[301]",
          "bg-(--color-bg-2) border border-(--color-line) rounded-2xl",
          "shadow-[0_30px_80px_rgba(0,0,0,0.5)]",
          "outline-none",
          "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
          "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
          "transition-all duration-200",
          className,
        )}
        {...props}
      >
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  );
}

function DialogTitle(props: Dialog.Title.Props) {
  return <Dialog.Title {...props} />;
}

function DialogDescription(props: Dialog.Description.Props) {
  return <Dialog.Description {...props} />;
}

function DialogClose(props: Dialog.Close.Props) {
  return <Dialog.Close {...props} />;
}

export {
  DialogRoot as Root,
  DialogTrigger as Trigger,
  DialogPanel as Panel,
  DialogTitle as Title,
  DialogDescription as Description,
  DialogClose as Close,
};
