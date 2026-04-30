"use client";
import * as React from "react";

import { cn } from "@/lib/utils";

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  variant?: "default" | "warn" | "error";
  action?: ToastAction;
}

interface ToastContextValue {
  show: (
    message: string,
    opts?: {
      variant?: ToastItem["variant"];
      /** @deprecated use durationMs */
      duration?: number;
      durationMs?: number;
      action?: ToastAction;
    },
  ) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

/**
 * Bottom-center toast provider per UI-SPEC §11 + Transcribe.html lines 374-390.
 * Uses role="status" aria-live="polite" for accessibility.
 * Toast animation uses the `toast` @keyframes from globals.css (D-07).
 *
 * Generalized in Plan 04-07 to support an `action` slot (e.g. Undo button for
 * delete-with-undo, D-11). When action is provided, default durationMs = 5000ms.
 */
function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);

  const show = React.useCallback<ToastContextValue["show"]>((message, opts) => {
    const id = ++idRef.current;
    const action = opts?.action;
    // backwards-compat: `duration` is the old name; `durationMs` is preferred.
    // When an action is present, default to 5000ms (D-11 — 5s undo window).
    const durationMs = opts?.durationMs ?? opts?.duration ?? (action ? 5000 : 1800);
    setToasts((prev) => [
      ...prev,
      { id, message, variant: opts?.variant ?? "default", action },
    ]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, durationMs);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2"
        style={{ bottom: 24 }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            data-slot="toast"
            data-variant={t.variant}
            className={cn(
              "px-4 py-2 rounded-(--radius-md) text-sm font-medium",
              "shadow-[0_10px_40px_rgba(0,0,0,0.5)]",
              "flex items-center",
              "data-[variant=default]:bg-[oklch(0.92_0.02_80)] data-[variant=default]:text-[oklch(0.20_0.02_70)]",
              "data-[variant=warn]:bg-(--color-warn) data-[variant=warn]:text-[oklch(0.20_0.02_50)]",
              "data-[variant=error]:bg-(--color-err) data-[variant=error]:text-(--color-fg-0)",
            )}
            style={{ animation: "toast 200ms ease-out" }}
          >
            <span>{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.onClick();
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                }}
                className="ml-3 text-(--color-accent) hover:underline cursor-pointer"
                style={{ background: "none", border: 0, padding: 0, font: "inherit" }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export { ToastProvider, useToast };
