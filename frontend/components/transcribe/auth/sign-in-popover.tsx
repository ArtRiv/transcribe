"use client";
// Sign-in popover anchored to the user button.
// 4 states: idle / submitting / sent / error (UI-SPEC §9.2).
// [Cited: 04-PATTERNS.md "sign-in-popover.tsx" row; 04-UI-SPEC §9.2]
import * as React from "react";
import * as Popover from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { signInWithMagicLink } from "@/lib/auth/actions";

type SignInState = "idle" | "submitting" | "sent" | "error";

interface SignInPopoverProps {
  /** The element that triggers the popover to open (rendered as Trigger child). */
  trigger: React.ReactNode;
}

/**
 * Magic-link sign-in popover (UI-SPEC §9.2 — 320px wide).
 *
 * State machine:
 *   idle       → submit → submitting → (ok) → sent
 *                                    → (err) → error
 *   error      → submit → submitting → (ok) → sent (retry-friendly)
 *   sent       → (terminal; user closes or gets email)
 *
 * Anti-pattern avoided: NO getSession() — server action uses getUser() via server client.
 */
export function SignInPopover({ trigger }: SignInPopoverProps) {
  const [state, setState] = React.useState<SignInState>("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending) return;
    setState("submitting");
    setError(null);

    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        const result = await signInWithMagicLink(fd);
        if (result.ok) {
          setState("sent");
        } else {
          setState("error");
          setError(result.error);
        }
      } catch {
        setState("error");
        setError("Something went wrong. Please try again.");
      }
    });
  };

  return (
    <Popover.Root>
      <Popover.Trigger render={trigger as React.ReactElement} />
      <Popover.Panel className="w-[320px] p-0">
        <div style={{ padding: "18px 18px 16px" }}>
          {/* Heading — Fraunces 20px (UI-SPEC §3) */}
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 20,
              fontWeight: 400,
              lineHeight: 1.2,
              color: "var(--color-fg-0)",
              marginBottom: 6,
            }}
          >
            Sign in
          </p>
          {/* Sub-heading — Inter 12.5px hint (UI-SPEC §3) */}
          <p
            style={{
              fontSize: "12.5px",
              fontWeight: 500,
              color: "var(--color-fg-3)",
              marginBottom: 16,
            }}
          >
            Sign in to keep your transcripts.
          </p>

          {state === "sent" ? (
            /* Sent state — replace form with success copy */
            <div
              style={{ textAlign: "center", padding: "8px 0 4px" }}
              aria-live="polite"
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "oklch(0.78 0.11 145 / 0.15)",
                  border: "1.5px solid var(--color-ok)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 12px",
                  fontSize: 20,
                }}
                aria-hidden="true"
              >
                ✓
              </div>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--color-fg-0)", marginBottom: 4 }}
              >
                Check your email
              </p>
              <p style={{ fontSize: "12.5px", color: "var(--color-fg-3)" }}>
                We sent a link to{" "}
                <span style={{ color: "var(--color-fg-1)", fontWeight: 500 }}>
                  {email}
                </span>
              </p>
            </div>
          ) : (
            /* Idle / submitting / error — show form */
            <form onSubmit={handleSubmit}>
              <Input
                type="email"
                name="email"
                placeholder="you@email.com"
                autoFocus
                autoComplete="email"
                required
                className="w-full mb-3"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={state === "submitting"}
                aria-label="Email address"
              />
              {/* Error message — inline below input */}
              {state === "error" && error && (
                <p
                  role="alert"
                  style={{
                    fontSize: "12px",
                    color: "var(--color-err)",
                    marginBottom: 10,
                    marginTop: -8,
                  }}
                >
                  {error}
                </p>
              )}
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                disabled={state === "submitting" || !email.trim()}
                aria-label="Send magic link"
              >
                {state === "submitting" ? "Sending…" : "Send magic link →"}
              </Button>
            </form>
          )}
        </div>

        {/* Footer hint (UI-SPEC §9.2 — anon TTL copy) */}
        <div
          style={{
            padding: "10px 18px 14px",
            borderTop: "1px solid var(--color-line)",
          }}
        >
          <p style={{ fontSize: "11.5px", color: "var(--color-fg-3)", lineHeight: 1.4 }}>
            Anonymous transcriptions disappear after 24 hours.
          </p>
        </div>
      </Popover.Panel>
    </Popover.Root>
  );
}
