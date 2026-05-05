"use client";
/**
 * pair-card.tsx
 *
 * PairCard — 5-state composite component for /pair?code=… (08-08 Task 1).
 * All copy, layout, and interaction follow 08-UI-SPEC.md verbatim.
 *
 * States (D-13..D-16, D-04):
 *   signed-out  — State 1: fingerprint preview + inline sign-in panel
 *   default     — State 2: fingerprint + "Pair this engine" button
 *   success     — State 3: success check + "Go to transcribe →" CTAs
 *   failure     — State 4: error icon + copy per reason (expired/network/engine-offline/generic)
 *   conflict    — State 5: existing device + Replace/Cancel (D-04)
 *
 * T-08-08-01: all field values come from trusted server-side fetched data and
 * are rendered via React text nodes — no dangerouslySetInnerHTML usage.
 * T-08-08-02: ed25519 value is the truncated first-16-hex + ellipsis only.
 */
import * as React from "react";
import {
  Monitor,
  Check,
  Clock,
  WifiOff,
  MonitorOff,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Copy,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ────────────────────────────────────────────────────────────────────────────
// Types (exported — pair-client.tsx and test files use them)
// ────────────────────────────────────────────────────────────────────────────

export interface PairFingerprint {
  device: string;  // OS hostname or "<engine>" fallback
  gpu: string;     // "RX 6600 (Vulkan)"
  engine: string;  // "v0.2.0"
  ed25519: string; // first 16 hex chars + "…"
}

export type PairState =
  | { kind: "signed-out"; fingerprint: PairFingerprint }
  | { kind: "default"; fingerprint: PairFingerprint }
  | { kind: "success" }
  | {
      kind: "conflict";
      fingerprint: PairFingerprint;
      existing: { name: string; gpu: string; last_seen: string };
    }
  | {
      kind: "failure";
      reason: "expired" | "network" | "engine-offline" | "generic";
      errorCode?: string;
    };

export interface PairCardProps {
  state: PairState;
  /** Called when the "Pair this engine" or "Try again" button is clicked. */
  onPair: () => void;
  /** Loading state — disables button, shows spinner. */
  isLoading?: boolean;
  /** Called when "Replace this engine" is confirmed (conflict state). */
  onReplace?: () => void;
  /** Called when "Cancel" is clicked in conflict state. */
  onCancelConflict?: () => void;
  /** Countdown string like "(expires in 8 min)" — shown under fingerprint when available. */
  expiresIn?: string;
  /** URL to redirect to for sign-in (preserves ?code param). */
  signInHref?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────────────────

/** Fingerprint block — dl/dt/dd for accessibility (08-UI-SPEC §Accessibility). */
function FingerprintBlock({
  fingerprint,
  expiresIn,
}: {
  fingerprint: PairFingerprint;
  expiresIn?: string;
}) {
  const rows: [string, string, boolean][] = (
    [
      ["device:", fingerprint.device, false],
      ["gpu:", fingerprint.gpu, false],
      ["engine:", fingerprint.engine, false],
      ["ed25519:", fingerprint.ed25519, true],
    ] as [string, string, boolean][]
  ).filter(([, value]) => value && value.length > 0);

  return (
    <div
      style={{
        background: "var(--color-bg-3)",
        border: "1px solid var(--color-line-soft)",
        borderRadius: "var(--radius-md)",
        padding: "var(--sp-3) var(--sp-4)",
        marginBottom: "var(--sp-5)",
        textAlign: "left",
      }}
    >
      <dl style={{ margin: 0 }}>
        {rows.map(([label, value, isAccent]) => (
          <div
            key={label}
            style={{
              display: "flex",
              gap: "var(--sp-3)",
              lineHeight: 1.6,
            }}
          >
            <dt
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--color-fg-3)",
                minWidth: 70,
                flexShrink: 0,
              }}
            >
              {label}
            </dt>
            <dd
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: isAccent
                  ? "var(--color-accent)"
                  : "var(--color-fg-1)",
                margin: 0,
                fontWeight: isAccent ? 400 : 400,
                wordBreak: "break-all",
              }}
              aria-label={
                label === "ed25519:"
                  ? "Ed25519 public key fingerprint"
                  : undefined
              }
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {expiresIn && (
        <div
          style={{
            fontSize: 12,
            color: "var(--color-fg-3)",
            marginTop: "var(--sp-2)",
          }}
        >
          {expiresIn}
        </div>
      )}
    </div>
  );
}

/** Pair icon circle — Monitor icon in amber accent (State 2 / State 1). */
function PairIconCircle() {
  return (
    <div
      aria-hidden
      style={{
        width: 64,
        height: 64,
        background: "var(--color-accent-soft)",
        color: "var(--color-accent)",
        borderRadius: "var(--radius-full)",
        display: "grid",
        placeItems: "center",
        margin: "0 auto var(--sp-5)",
      }}
    >
      <Monitor size={28} strokeWidth={1.8} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// State renderers
// ────────────────────────────────────────────────────────────────────────────

function PairCardSignedOut({
  fingerprint,
  expiresIn,
  signInHref,
}: {
  fingerprint: PairFingerprint;
  expiresIn?: string;
  signInHref?: string;
}) {
  return (
    <>
      <PairIconCircle />
      <h1
        className="serif"
        style={{
          fontSize: 24,
          color: "var(--color-fg-0)",
          marginBottom: "var(--sp-2)",
          fontVariationSettings: "normal",
        }}
      >
        Engine running on your computer
      </h1>
      <p style={{ fontSize: 14, color: "var(--color-fg-2)", marginBottom: "var(--sp-5)" }}>
        Pair it to your account so this site can route jobs to it.
      </p>
      <FingerprintBlock fingerprint={fingerprint} expiresIn={expiresIn} />

      {/* Inline sign-in panel (D-14) */}
      <div
        style={{
          borderTop: "1px solid var(--color-line-soft)",
          paddingTop: "var(--sp-5)",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-fg-0)",
            marginBottom: "var(--sp-2)",
          }}
        >
          Sign in to pair this engine
        </p>
        <p style={{ fontSize: 14, color: "var(--color-fg-2)", marginBottom: "var(--sp-4)" }}>
          You&apos;ll be taken back to this page after signing in.
        </p>
        <Button
          variant="primary"
          style={{ width: "100%", height: 48 }}
          onClick={() => {
            if (signInHref) window.location.href = signInHref;
          }}
        >
          Sign in with email →
        </Button>
      </div>
    </>
  );
}

function PairCardDefault({
  fingerprint,
  expiresIn,
  onPair,
  isLoading,
}: {
  fingerprint: PairFingerprint;
  expiresIn?: string;
  onPair: () => void;
  isLoading?: boolean;
}) {
  return (
    <>
      <PairIconCircle />
      <h1
        className="serif"
        style={{
          fontSize: 24,
          color: "var(--color-fg-0)",
          marginBottom: "var(--sp-2)",
          fontVariationSettings: "normal",
        }}
      >
        Engine running on your computer
      </h1>
      <p style={{ fontSize: 14, color: "var(--color-fg-2)", marginBottom: "var(--sp-5)" }}>
        Pair it to your account so this site can route jobs to it.
      </p>
      <FingerprintBlock fingerprint={fingerprint} expiresIn={expiresIn} />
      <Button
        variant="primary"
        style={{ width: "100%", height: 48 }}
        onClick={onPair}
        disabled={isLoading}
        aria-busy={isLoading ? "true" : undefined}
        aria-label={isLoading ? "Pairing…" : "Pair this engine"}
      >
        {isLoading ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Pairing…
          </span>
        ) : (
          "Pair this engine"
        )}
      </Button>
      <button
        style={{
          background: "none",
          border: "none",
          fontSize: 12,
          color: "var(--color-fg-3)",
          marginTop: "var(--sp-3)",
          cursor: "pointer",
          padding: 0,
        }}
        onClick={() => window.history.back()}
      >
        Not your engine?
      </button>
    </>
  );
}

function PairCardSuccess() {
  return (
    <div role="status">
      {/* Success check circle */}
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          background: "oklch(0.78 0.11 145 / 0.15)",
          color: "var(--color-ok)",
          borderRadius: "var(--radius-full)",
          display: "grid",
          placeItems: "center",
          margin: "0 auto var(--sp-5)",
        }}
      >
        <svg
          width={24}
          height={24}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            strokeDasharray: 30,
            strokeDashoffset: 0,
            animation: "drawCheck 0.4s ease forwards",
          }}
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <h1
        className="serif"
        style={{
          fontSize: 24,
          color: "var(--color-fg-0)",
          marginBottom: "var(--sp-2)",
          fontVariationSettings: "normal",
        }}
      >
        You&apos;re all set.
      </h1>
      <p style={{ fontSize: 14, color: "var(--color-fg-2)", marginBottom: "var(--sp-5)" }}>
        Your engine is paired. Drop a file on the transcribe page and it&apos;ll run
        on your machine.
      </p>
      <a
        href="/"
        style={{
          display: "block",
          width: "100%",
          height: 48,
          lineHeight: "48px",
          textAlign: "center",
          background: "var(--color-accent)",
          color: "oklch(0.20 0.020 70)",
          borderRadius: "var(--radius-md)",
          fontWeight: 600,
          fontSize: 13,
          textDecoration: "none",
          marginBottom: "var(--sp-2)",
        }}
      >
        Go to transcribe →
      </a>
      <a
        href="/account/devices"
        style={{
          display: "block",
          width: "100%",
          height: 48,
          lineHeight: "48px",
          textAlign: "center",
          background: "var(--color-bg-3)",
          color: "var(--color-fg-1)",
          borderRadius: "var(--radius-md)",
          fontWeight: 500,
          fontSize: 13,
          textDecoration: "none",
          border: "1px solid var(--color-line)",
        }}
      >
        Manage devices
      </a>
    </div>
  );
}

function PairCardFailure({
  reason,
  errorCode,
  onPair,
  isLoading,
}: {
  reason: "expired" | "network" | "engine-offline" | "generic";
  errorCode?: string;
  onPair: () => void;
  isLoading?: boolean;
}) {
  const iconMap = {
    expired: <Clock size={32} color="var(--color-err)" aria-hidden />,
    network: <WifiOff size={32} color="var(--color-err)" aria-hidden />,
    "engine-offline": <MonitorOff size={32} color="var(--color-err)" aria-hidden />,
    generic: <AlertCircle size={32} color="var(--color-err)" aria-hidden />,
  };

  const headingMap = {
    expired: "Pairing code expired.",
    network: "Can't reach the server.",
    "engine-offline": "Engine not detected.",
    generic: "Pairing failed.",
  };

  const bodyMap = {
    expired: "Restart the engine to get a new code, then come back to this page.",
    network: "Check your internet connection.",
    "engine-offline":
      "We don't see your engine online. Make sure the tray icon is visible.",
    generic: "Something went wrong. Copy the error code below and try again.",
  };

  const showTryAgain = reason !== "expired";

  return (
    <>
      {/* Announce failure to screen readers immediately (role="alert"). */}
      <span role="alert" className="sr-only">
        {headingMap[reason]}
      </span>
      <div
        style={{
          position: "absolute",
          top: "var(--sp-4)",
          right: "var(--sp-4)",
          lineHeight: 0,
        }}
      >
        {iconMap[reason]}
      </div>
      <h1
        className="serif"
        style={{
          fontSize: 24,
          color: "var(--color-fg-0)",
          marginBottom: "var(--sp-2)",
          fontVariationSettings: "normal",
        }}
      >
        {headingMap[reason]}
      </h1>
      <p style={{ fontSize: 14, color: "var(--color-fg-2)", marginBottom: "var(--sp-5)" }}>
        {bodyMap[reason]}
      </p>

      {reason === "generic" && errorCode && (
        <div
          style={{
            background: "var(--color-bg-3)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--sp-2) var(--sp-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-fg-1)",
            textAlign: "left",
            marginBottom: "var(--sp-4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{errorCode}</span>
          <button
            onClick={() => navigator.clipboard.writeText(errorCode)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--color-fg-3)",
              padding: 0,
            }}
            aria-label="Copy error code"
          >
            <Copy size={14} />
          </button>
        </div>
      )}

      {showTryAgain && (
        <Button
          variant="default"
          style={{ width: "100%", height: 40 }}
          onClick={onPair}
          disabled={isLoading}
        >
          {isLoading ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Trying…
            </span>
          ) : (
            "Try again"
          )}
        </Button>
      )}
    </>
  );
}

function PairCardConflict({
  fingerprint,
  existing,
  onReplace,
  onCancelConflict,
  isLoading,
}: {
  fingerprint: PairFingerprint;
  existing: { name: string; gpu: string; last_seen: string };
  onReplace?: () => void;
  onCancelConflict?: () => void;
  isLoading?: boolean;
}) {
  const relativeTime = React.useMemo(() => {
    try {
      const diff = Date.now() - new Date(existing.last_seen).getTime();
      const hours = Math.floor(diff / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      if (hours > 0) return `${hours} hour${hours !== 1 ? "s" : ""} ago`;
      if (minutes > 0) return `${minutes} minute${minutes !== 1 ? "s" : ""} ago`;
      return "just now";
    } catch {
      return existing.last_seen;
    }
  }, [existing.last_seen]);

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: "var(--sp-4)",
          right: "var(--sp-4)",
          lineHeight: 0,
        }}
      >
        <AlertTriangle size={32} color="var(--color-warn)" aria-hidden />
      </div>
      <h1
        className="serif"
        style={{
          fontSize: 24,
          color: "var(--color-fg-0)",
          marginBottom: "var(--sp-2)",
          fontVariationSettings: "normal",
        }}
      >
        You already have an engine paired.
      </h1>
      <p style={{ fontSize: 14, color: "var(--color-fg-2)", marginBottom: "var(--sp-5)" }}>
        Pairing this engine will replace the one below.
      </p>

      {/* Existing device block — border-left amber (UI-SPEC State 5) */}
      <div
        aria-describedby="conflict-warning"
        style={{
          background: "var(--color-bg-3)",
          border: "1px solid var(--color-line-soft)",
          borderLeft: "3px solid var(--color-warn)",
          borderRadius: "var(--radius-md)",
          padding: "var(--sp-3) var(--sp-4)",
          marginBottom: "var(--sp-5)",
          textAlign: "left",
        }}
      >
        <dl style={{ margin: 0 }}>
          {[
            ["device:", existing.name],
            ["gpu:", existing.gpu],
            ["last seen:", relativeTime],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", gap: "var(--sp-3)", lineHeight: 1.6 }}>
              <dt
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--color-fg-3)",
                  minWidth: 80,
                  flexShrink: 0,
                }}
              >
                {label}
              </dt>
              <dd
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--color-fg-1)",
                  margin: 0,
                }}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p id="conflict-warning" className="sr-only">
        Pairing this engine will replace the device listed above.
      </p>

      <div style={{ display: "flex", gap: "var(--sp-2)" }}>
        <Button
          variant="default"
          style={{
            flex: 1,
            height: 40,
            color: "var(--color-err)",
            borderColor: "var(--color-err)",
          }}
          onClick={onReplace}
          disabled={isLoading}
        >
          {isLoading ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Loader2 size={14} className="animate-spin" aria-hidden />
              Replacing…
            </span>
          ) : (
            "Replace this engine"
          )}
        </Button>
        <Button
          variant="ghost"
          style={{ flex: 1, height: 40 }}
          onClick={onCancelConflict}
          disabled={isLoading}
        >
          Cancel
        </Button>
      </div>

      {/* Show new fingerprint below conflict block */}
      <div style={{ marginTop: "var(--sp-5)" }}>
        <p style={{ fontSize: 12, color: "var(--color-fg-3)", marginBottom: "var(--sp-2)" }}>
          New engine to pair:
        </p>
        <FingerprintBlock fingerprint={fingerprint} />
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

/** PairCard — all 5 UI-SPEC states for /pair?code=… */
export function PairCard({
  state,
  onPair,
  isLoading,
  onReplace,
  onCancelConflict,
  expiresIn,
  signInHref,
}: PairCardProps) {
  let inner: React.ReactNode;

  switch (state.kind) {
    case "signed-out":
      inner = (
        <PairCardSignedOut
          fingerprint={state.fingerprint}
          expiresIn={expiresIn}
          signInHref={signInHref}
        />
      );
      break;

    case "default":
      inner = (
        <PairCardDefault
          fingerprint={state.fingerprint}
          expiresIn={expiresIn}
          onPair={onPair}
          isLoading={isLoading}
        />
      );
      break;

    case "success":
      inner = <PairCardSuccess />;
      break;

    case "failure":
      inner = (
        <PairCardFailure
          reason={state.reason}
          errorCode={state.errorCode}
          onPair={onPair}
          isLoading={isLoading}
        />
      );
      break;

    case "conflict":
      inner = (
        <PairCardConflict
          fingerprint={state.fingerprint}
          existing={state.existing}
          onReplace={onReplace}
          onCancelConflict={onCancelConflict}
          isLoading={isLoading}
        />
      );
      break;
  }

  return (
    <Card
      style={{
        position: "relative",
        maxWidth: 480,
        width: "100%",
        padding: "var(--sp-7) var(--sp-6)",
        textAlign: "center",
        animation: "fade 0.25s ease",
      }}
    >
      {inner}
    </Card>
  );
}
