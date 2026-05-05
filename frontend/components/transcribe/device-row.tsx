"use client";
/**
 * device-row.tsx
 *
 * DeviceRow — single paired device listing with inline-confirm Unpair flow.
 * Part of /account/devices (08-08 Task 2, D-23).
 *
 * UI-SPEC §"Interaction Contracts" /account/devices §"Unpair":
 *   - Click "Unpair" → shows inline "Are you sure? Unpair" + Cancel (NO modal)
 *   - Confirm → calls onUnpair; on success row fades; on error shows inline message
 *   - aria-expanded on Unpair button per accessibility spec
 */
import * as React from "react";
import { Button } from "@/components/ui/button";

export type Result<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export interface DeviceRowDevice {
  name: string;
  gpu: string;
  last_seen: string;
}

interface DeviceRowProps {
  device: DeviceRowDevice;
  /** Called when unpair is confirmed. Should POST to /api/unpair. */
  onUnpair: () => Promise<Result>;
}

type RowState =
  | { kind: "idle" }
  | { kind: "confirming" }
  | { kind: "unpairing" }
  | { kind: "failed"; error: string };

/** Format a UTC ISO timestamp as "N hours ago" / "N minutes ago" / "just now". */
function relativeTime(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const hours = Math.floor(diff / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    if (hours > 0) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
    if (minutes > 0) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
    return "just now";
  } catch {
    return iso;
  }
}

/** DeviceRow — single device row with inline Unpair confirmation. */
export function DeviceRow({ device, onUnpair }: DeviceRowProps) {
  const [rowState, setRowState] = React.useState<RowState>({ kind: "idle" });
  const [visible, setVisible] = React.useState(true);

  async function handleConfirmUnpair() {
    setRowState({ kind: "unpairing" });
    const res = await onUnpair();
    if (res.ok) {
      // Fade out the row
      setVisible(false);
    } else {
      setRowState({ kind: "failed", error: res.error });
    }
  }

  if (!visible) return null;

  return (
    <div
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-line)",
        borderRadius: "var(--radius-lg)",
        padding: "var(--sp-4) var(--sp-5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: 44,
        opacity: rowState.kind === "unpairing" ? 0.5 : 1,
        pointerEvents: rowState.kind === "unpairing" ? "none" : undefined,
        transition: "opacity 0.2s ease",
      }}
    >
      {/* Left: device name + secondary line */}
      <div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-fg-0)",
            marginBottom: 2,
          }}
        >
          {device.name}
        </div>
        <div style={{ fontSize: 12, color: "var(--color-fg-3)" }}>
          {device.gpu} · last seen {relativeTime(device.last_seen)}
        </div>
        {rowState.kind === "failed" && (
          <div style={{ fontSize: 12, color: "var(--color-err)", marginTop: 4 }}>
            {rowState.error}
          </div>
        )}
      </div>

      {/* Right: Unpair button / inline confirm */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexShrink: 0 }}>
        {rowState.kind === "idle" || rowState.kind === "failed" ? (
          <Button
            variant="default"
            size="sm"
            aria-expanded={false}
            onClick={() => setRowState({ kind: "confirming" })}
          >
            Unpair
          </Button>
        ) : rowState.kind === "confirming" ? (
          <>
            <Button
              variant="default"
              size="sm"
              aria-expanded={true}
              style={{ color: "var(--color-err)", borderColor: "var(--color-err)" }}
              onClick={handleConfirmUnpair}
            >
              Are you sure? Unpair
            </Button>
            <button
              style={{
                background: "none",
                border: "none",
                fontSize: 12,
                color: "var(--color-fg-3)",
                cursor: "pointer",
                padding: 0,
              }}
              onClick={() => setRowState({ kind: "idle" })}
            >
              Cancel
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
