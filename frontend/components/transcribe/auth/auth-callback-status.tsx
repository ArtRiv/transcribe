"use client";
// Auth callback status component — rendered at /auth/callback page.
// 3 states: verifying (default), success (auto-redirect), error (show message + retry).
// [Cited: 04-UI-SPEC §9.4; 04-PATTERNS.md "auth-callback-status.tsx" row]
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

interface AuthCallbackStatusProps {
  /** Non-null when the route handler redirected here with ?error=<code>. */
  error: string | null;
}

/**
 * Renders a centered card matching UI-SPEC §9.4:
 * - verifying: spinner + "Verifying your link…"
 * - success: checkmark + "Signed in. Redirecting…" → auto-redirects to / after 350ms
 * - error: error ring + message + "Try again" button → router.replace('/')
 *
 * The RSC wrapper (app/auth/callback/page.tsx) determines the initial state by
 * forwarding the `error` prop. Successful logins redirect before page renders —
 * this component handles only the error case and an optional success beat.
 */
export function AuthCallbackStatus({ error }: AuthCallbackStatusProps) {
  const router = useRouter();
  const [phase, setPhase] = React.useState<"verifying" | "success" | "error">(
    error ? "error" : "verifying",
  );

  // Auto-redirect on verifying (no error = success case: route.ts already set the session).
  React.useEffect(() => {
    if (error) {
      setPhase("error");
      return;
    }
    // Give a brief success beat (UI-SPEC §9.4 — 350ms before redirect).
    setPhase("success");
    const t = setTimeout(() => {
      router.replace("/");
    }, 350);
    return () => clearTimeout(t);
  }, [error, router]);

  const errorMessage =
    error === "invalid"
      ? "The magic link is invalid or has expired. Please request a new one."
      : error
        ? "Something went wrong. Please try again."
        : null;

  return (
    <div
      style={{
        display: "grid",
        placeItems: "center",
        minHeight: "calc(100dvh - 64px)",
        padding: "32px 24px",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          padding: "40px 32px",
          background: "var(--color-bg-2)",
          borderRadius: 16,
          textAlign: "center",
        }}
        role="status"
        aria-live="polite"
      >
        {/* Status icon */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            fontSize: 24,
            ...(phase === "error"
              ? {
                  background: "oklch(0.72 0.15 25 / 0.12)",
                  border: "1.5px solid var(--color-err)",
                  color: "var(--color-err)",
                }
              : phase === "success"
                ? {
                    background: "oklch(0.78 0.11 145 / 0.12)",
                    border: "1.5px solid var(--color-ok)",
                    color: "var(--color-ok)",
                  }
                : {
                    background: "var(--color-bg-3)",
                    border: "1.5px solid var(--color-line)",
                    color: "var(--color-fg-3)",
                  }),
          }}
          aria-hidden="true"
        >
          {phase === "error" ? "✕" : phase === "success" ? "✓" : "◐"}
        </div>

        {/* Heading — Fraunces 28px (UI-SPEC §3) */}
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 28,
            fontWeight: 400,
            lineHeight: 1.1,
            color: "var(--color-fg-0)",
            marginBottom: 10,
          }}
        >
          {phase === "error"
            ? "Couldn't verify the link."
            : phase === "success"
              ? "Signed in."
              : "Verifying your link…"}
        </p>

        {/* Sub-text — Inter 14px (UI-SPEC §3) */}
        <p style={{ fontSize: 14, color: "var(--color-fg-3)", lineHeight: 1.5 }}>
          {phase === "error"
            ? errorMessage
            : phase === "success"
              ? "Redirecting…"
              : "Just a sec."}
        </p>

        {/* Error retry button */}
        {phase === "error" && (
          <Button
            variant="ghost"
            className="mt-6"
            onClick={() => router.replace("/")}
          >
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}
