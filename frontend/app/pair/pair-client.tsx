"use client";
/**
 * pair-client.tsx
 *
 * PairClient — useReducer state machine driving the 5 pair page states.
 * Handles: idle → confirming → success | failure | conflict (08-08 Task 2).
 *
 * Route mapping (D-16):
 *   200 ok          → confirm_success
 *   410 expired_or_unknown → failure(reason: 'expired')
 *   409 device_conflict   → conflict(existing device data)
 *   401              → redirect to /auth?next=/pair?code=…
 *   429              → failure(reason: 'network')
 *   network exception → failure(reason: 'network')
 *   5xx / other      → failure(reason: 'generic')
 */
import * as React from "react";
import { PairCard } from "@/components/transcribe/pair-card";
import type { PairState, PairFingerprint } from "@/components/transcribe/pair-card";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

interface ExistingDevice {
  name: string;
  gpu: string;
  last_seen: string;
}

export interface PairClientProps {
  code: string;
  fingerprint: PairFingerprint;
  /** Determines the initial state of the card (from RSC server-side determination). */
  initialKind: "default" | "signed-out" | "conflict" | "failure";
  existingDevice?: ExistingDevice;
  failureReason?: "expired" | "network" | "engine-offline" | "generic";
  /** Countdown string like "(expires in 8 min)" from RSC. */
  expiresIn?: string;
  /** Sign-in redirect URL (from RSC, includes ?code preservation). */
  signInHref?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Reducer
// ────────────────────────────────────────────────────────────────────────────

type ClientState =
  | { kind: "idle"; pairState: PairState }
  | { kind: "confirming"; pairState: PairState };

type ClientAction =
  | { type: "confirm" }
  | { type: "confirm_success" }
  | {
      type: "confirm_failure";
      reason: "expired" | "network" | "engine-offline" | "generic";
      errorCode?: string;
    }
  | {
      type: "conflict";
      existing: ExistingDevice;
    }
  | { type: "replace" }
  | { type: "cancel" };

function buildInitialPairState(props: PairClientProps): PairState {
  switch (props.initialKind) {
    case "signed-out":
      return { kind: "signed-out", fingerprint: props.fingerprint };
    case "conflict":
      return {
        kind: "conflict",
        fingerprint: props.fingerprint,
        existing: props.existingDevice ?? {
          name: "",
          gpu: "",
          last_seen: new Date().toISOString(),
        },
      };
    case "failure":
      return {
        kind: "failure",
        reason: props.failureReason ?? "generic",
      };
    default:
      return { kind: "default", fingerprint: props.fingerprint };
  }
}

function reducer(state: ClientState, action: ClientAction): ClientState {
  switch (action.type) {
    case "confirm":
      return {
        kind: "confirming",
        pairState: { ...state.pairState },
      };
    case "replace":
      return {
        kind: "confirming",
        pairState: { ...state.pairState },
      };
    case "confirm_success":
      return {
        kind: "idle",
        pairState: { kind: "success" },
      };
    case "confirm_failure":
      return {
        kind: "idle",
        pairState: {
          kind: "failure",
          reason: action.reason,
          errorCode: action.errorCode,
        },
      };
    case "conflict":
      return {
        kind: "idle",
        pairState: {
          kind: "conflict",
          fingerprint:
            "fingerprint" in state.pairState
              ? state.pairState.fingerprint
              : { device: "", gpu: "", engine: "", ed25519: "" },
          existing: action.existing,
        },
      };
    case "cancel":
      return {
        kind: "idle",
        pairState:
          state.pairState.kind === "conflict"
            ? {
                kind: "default",
                fingerprint: state.pairState.fingerprint,
              }
            : state.pairState,
      };
    default:
      return state;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

/** PairClient — client-side state machine for /pair?code=… */
export function PairClient({
  code,
  fingerprint,
  initialKind,
  existingDevice,
  failureReason,
  expiresIn,
  signInHref,
}: PairClientProps) {
  const initialState = React.useMemo(
    () =>
      ({
        kind: "idle",
        pairState: buildInitialPairState({
          code,
          fingerprint,
          initialKind,
          existingDevice,
          failureReason,
          expiresIn,
          signInHref,
        }),
      }) as ClientState,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [state, dispatch] = React.useReducer(reducer, initialState);
  const isConfirming = state.kind === "confirming";

  async function handlePair(replace = false) {
    dispatch({ type: replace ? "replace" : "confirm" });

    try {
      const res = await fetch(`/api/pair-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(replace ? { code, replace: true } : { code }),
      });

      if (res.ok) {
        dispatch({ type: "confirm_success" });
        return;
      }

      const data = await res.json().catch(() => ({}));

      if (res.status === 410) {
        dispatch({ type: "confirm_failure", reason: "expired" });
      } else if (res.status === 409 && data.existing) {
        dispatch({ type: "conflict", existing: data.existing });
      } else if (res.status === 401) {
        // Redirect to sign-in preserving ?code
        window.location.href = `/auth?next=/pair?code=${encodeURIComponent(code)}`;
      } else if (res.status === 429) {
        dispatch({ type: "confirm_failure", reason: "network" });
      } else if (res.status >= 500) {
        dispatch({
          type: "confirm_failure",
          reason: "generic",
          errorCode: data.error ?? `HTTP_${res.status}`,
        });
      } else {
        dispatch({
          type: "confirm_failure",
          reason: "generic",
          errorCode: data.error ?? `HTTP_${res.status}`,
        });
      }
    } catch {
      dispatch({ type: "confirm_failure", reason: "network" });
    }
  }

  return (
    <PairCard
      state={state.pairState}
      onPair={() => handlePair(false)}
      isLoading={isConfirming}
      onReplace={() => handlePair(true)}
      onCancelConflict={() => dispatch({ type: "cancel" })}
      expiresIn={expiresIn}
      signInHref={signInHref}
    />
  );
}
