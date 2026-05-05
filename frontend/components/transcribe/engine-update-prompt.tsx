"use client";
/**
 * engine-update-prompt.tsx
 *
 * Inline panel shown when the paired engine is below the minimum supported
 * version (VERSION-02, VERSION-03). Renders nothing when the engine is current.
 *
 * Usage:
 *   <EngineUpdatePrompt engineVersion="0.1.0" minVersion="0.2.0" />
 *
 * Security note: engineVersion and minVersion are semver strings from trusted
 * sources (pending_pairings row and Vercel env var respectively) — rendered
 * as text content only, no innerHTML.
 */
import * as React from "react";
import { isEngineCurrent } from "@/lib/version/compare";

interface EngineUpdatePromptProps {
  /** The version string reported by the engine (e.g. "0.1.0"). */
  engineVersion: string;
  /** The minimum supported version (NEXT_PUBLIC_MIN_ENGINE_VERSION or explicit override). */
  minVersion: string;
}

/**
 * Renders an inline update-required panel when `!isEngineCurrent(engineVersion)`.
 * Returns null when the engine version meets or exceeds the minimum.
 */
export function EngineUpdatePrompt({
  engineVersion,
  minVersion,
}: EngineUpdatePromptProps) {
  if (isEngineCurrent(engineVersion)) return null;

  return (
    <div
      role="alert"
      style={{
        background: "var(--color-bg-3)",
        border: "1px solid var(--color-warn)",
        borderRadius: "var(--radius-md)",
        padding: "var(--sp-4) var(--sp-5)",
        maxWidth: 480,
        width: "100%",
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
        Engine update available
      </p>
      <p
        style={{
          fontSize: 14,
          color: "var(--color-fg-2)",
          marginBottom: "var(--sp-4)",
        }}
      >
        Your engine is at v{engineVersion}. The minimum supported version is v
        {minVersion}. Update to continue.
      </p>
      <a
        href="https://github.com/artriv/transcribe-engine/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-block",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--color-accent)",
          textDecoration: "underline",
        }}
      >
        Download latest
      </a>
    </div>
  );
}
