"use client";

/**
 * Per-route error boundary (D-22) — UI-SPEC §11.
 * Mounted automatically by Next.js when the page or any client island throws.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      style={{
        padding: 32,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 12,
        textAlign: "center",
        color: "var(--color-fg-1)",
      }}
    >
      <h2 style={{ fontSize: 20, fontWeight: 500 }}>Something broke</h2>
      <p
        style={{
          color: "var(--color-fg-3)",
          fontSize: 13.5,
          maxWidth: 480,
        }}
      >
        {error.message}
      </p>
      <button
        type="button"
        onClick={reset}
        style={{
          padding: "8px 14px",
          background: "var(--color-bg-3)",
          color: "var(--color-fg-1)",
          border: "1px solid var(--color-line)",
          borderRadius: "var(--radius-md)",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}
