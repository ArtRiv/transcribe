"use client";
// AnonPromotionBanner — UI-SPEC §8.3 + D-08.
// Mirrors restore-pill.tsx (banner-with-two-buttons metaphor verbatim).
// Shown in editor-client.tsx when: signed-in user is viewing a job that
// was created anonymously (no transcripts row for this auth.uid()).
//
// [Cited: 04-PATTERNS.md anon-promotion-banner.tsx row; 04-08 PLAN Task 2]

import * as React from "react";
import { Button } from "@/components/ui/button";

export interface AnonPromotionBannerProps {
  onSave(): Promise<void>;
  onDiscard(): void;
  onDismiss?(): void;
  saving?: boolean;
}

/**
 * D-08: Anon-to-signed-in promotion banner.
 *
 * Renders a banner prompting the user to save their anonymous transcript to
 * their account. On "Save", calls onSave (promoteAnonJob) and dismisses.
 * On "Discard", calls onDiscard and dismisses.
 */
export function AnonPromotionBanner({
  onSave,
  onDiscard,
  onDismiss,
  saving = false,
}: AnonPromotionBannerProps) {
  const [dismissed, setDismissed] = React.useState(false);

  if (dismissed) return null;

  const handleSave = async () => {
    await onSave();
    setDismissed(true);
  };

  const handleDiscard = () => {
    onDiscard();
    setDismissed(true);
  };

  const handleDismiss = () => {
    onDismiss?.();
    setDismissed(true);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        margin: "12px auto",
        maxWidth: 720,
        padding: "8px 14px",
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-accent-line)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 12.5,
        color: "var(--color-fg-1)",
      }}
    >
      <span style={{ flex: 1 }}>
        Save this transcript to your account?
      </span>
      <Button
        variant="primary"
        size="sm"
        onClick={handleSave}
        disabled={saving}
        aria-label="Save transcript to account"
      >
        {saving ? "Saving…" : "Save"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDiscard}
        disabled={saving}
        aria-label="Discard and keep anonymous"
      >
        Discard
      </Button>
      {onDismiss ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          disabled={saving}
          aria-label="Dismiss"
          style={{ padding: "0 6px", minWidth: "unset" }}
        >
          ×
        </Button>
      ) : null}
    </div>
  );
}
