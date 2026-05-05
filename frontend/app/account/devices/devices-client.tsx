"use client";
/**
 * devices-client.tsx
 *
 * DevicesClient — inline Unpair flow for /account/devices (08-08 Task 2, D-23).
 * Owns optimistic-remove + revert-on-error logic (mirrors history-client.tsx).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { DeviceRow } from "@/components/transcribe/device-row";
import type { DeviceRowDevice } from "@/components/transcribe/device-row";

interface DevicesClientProps {
  initialDevice: DeviceRowDevice | null;
}

type State =
  | { kind: "has-device"; device: DeviceRowDevice }
  | { kind: "empty" };

type Action =
  | { type: "unpaired" }
  | { type: "error"; device: DeviceRowDevice };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "unpaired":
      return { kind: "empty" };
    case "error":
      return { kind: "has-device", device: action.device };
  }
}

const ENGINE_REPO_README =
  "https://github.com/artriv/transcribe-engine#readme";

/** Renders the single paired device row or empty state. */
export function DevicesClient({ initialDevice }: DevicesClientProps) {
  const router = useRouter();
  const [state, dispatch] = React.useReducer(
    reducer,
    initialDevice
      ? { kind: "has-device", device: initialDevice }
      : { kind: "empty" }
  );

  async function handleUnpair() {
    // Capture current device for possible revert
    const currentDevice =
      state.kind === "has-device" ? state.device : null;

    try {
      const res = await fetch("/api/unpair", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        dispatch({ type: "unpaired" });
        router.refresh();
        return { ok: true as const };
      }

      // Revert: keep the row visible on error
      if (currentDevice) {
        dispatch({ type: "error", device: currentDevice });
      }
      return { ok: false as const, error: data.error ?? "Failed to unpair" };
    } catch {
      if (currentDevice) {
        dispatch({ type: "error", device: currentDevice });
      }
      return {
        ok: false as const,
        error: "Network error — check your connection",
      };
    }
  }

  if (state.kind === "empty") {
    return (
      <div
        style={{
          textAlign: "center",
          color: "var(--color-fg-3)",
          fontSize: 14,
          paddingTop: "var(--sp-7)",
        }}
      >
        <p
          style={{
            fontSize: 16,
            fontWeight: 500,
            color: "var(--color-fg-2)",
            marginBottom: "var(--sp-2)",
          }}
        >
          No engine paired yet.
        </p>
        <p style={{ marginBottom: "var(--sp-4)" }}>
          Install and run the engine, then visit the pair link it generates.
        </p>
        <a
          href={ENGINE_REPO_README}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--color-accent)",
            fontSize: 13,
            textDecoration: "underline",
          }}
        >
          Learn how to install →
        </a>
      </div>
    );
  }

  return (
    <DeviceRow device={state.device} onUnpair={handleUnpair} />
  );
}
