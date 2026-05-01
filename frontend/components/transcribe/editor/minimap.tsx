"use client";
import * as React from "react";
import type { Segment, Speaker } from "@/lib/editor/reducer";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Segmented } from "@/components/ui/segmented";

export type MinimapScale = 1 | 2 | 3;

interface MinimapProps {
  segments: Segment[];
  speakers: Speaker[];
  /** Current playback time in seconds — drives the playhead position. */
  playT: number;
  totalDuration: number;
  activeSegId: string | null;
  onJump: (seg: Segment) => void;
  /** Optional scale state lifted out so a sibling Timeline can match it.
   *  When omitted, Minimap manages its own scale + persists to localStorage. */
  scale?: MinimapScale;
  onScaleChange?: (s: MinimapScale) => void;
  className?: string;
}

/**
 * Right rail overview — segment stripes + 1.5px accent playhead (D-27).
 *
 * Stripe height = max(8, min(36, duration_s * 1.6)) per D-27 spec.
 * Speaker color cycles by index (D-05): var(--color-sp-{(idx % 5) + 1}).
 * Playhead is 1.5px accent line with glow, absolutely positioned on the stripe column.
 *
 * Spec: editor.jsx lines ~634-716.
 */
const SCALE_STORAGE_KEY = "transcribe.minimapScale";

export function Minimap({
  segments,
  speakers,
  playT,
  totalDuration,
  activeSegId,
  onJump,
  scale: scaleProp,
  onScaleChange,
  className,
}: MinimapProps) {
  const { t } = useI18n();
  // Build a speaker-id → index map for O(1) color lookup.
  const speakerIndex = React.useMemo(() => {
    const m = new Map<string, number>();
    speakers.forEach((sp, i) => m.set(sp.id, i));
    return m;
  }, [speakers]);

  // Internal scale state used when the parent doesn't lift it. Persisted to
  // localStorage so the user's preference survives reloads. Default = 2×
  // (item 9 of "things to change 2.txt") — at 1× the bars are too thin to
  // host a readable text preview, and the user wants the preview on by
  // default. localStorage still wins when present so users who set 1×
  // explicitly aren't overridden. Lazy initializer avoids the
  // setState-in-effect cascade lint rule.
  const [internalScale, setInternalScale] = React.useState<MinimapScale>(() => {
    try {
      const stored = window.localStorage.getItem(SCALE_STORAGE_KEY);
      if (stored === "1" || stored === "2" || stored === "3") {
        return Number(stored) as MinimapScale;
      }
    } catch {
      /* SSR or private mode — fall through */
    }
    return 2;
  });
  const scale = scaleProp ?? internalScale;
  const setScale = React.useCallback(
    (s: MinimapScale) => {
      if (onScaleChange) {
        onScaleChange(s);
      } else {
        setInternalScale(s);
      }
      try {
        window.localStorage.setItem(SCALE_STORAGE_KEY, String(s));
      } catch {
        /* private mode — accept session-only persistence */
      }
    },
    [onScaleChange],
  );

  const playheadPct = totalDuration > 0 ? (playT / totalDuration) * 100 : 0;

  return (
    <aside
      className={className}
      aria-label={t.editor_overview}
      style={{
        padding: 12,
        borderLeft: "1px solid var(--color-line)",
        background: "var(--color-bg-1)",
        position: "relative",
        overflow: "auto",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--color-fg-3)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 12,
        }}
      >
        {t.editor_overview}
      </div>

      {/* 1x/2x/3x scale buttons — item line 43 of Things-to-change.txt.
          Default 1x matches the original visual size, so users who don't
          touch the control see no regression. 3x caps stripe height at
          108px (36 * 3) below to avoid absurdly tall bars on long segments. */}
      <div
        style={{
          marginBottom: 10,
          display: "flex",
          justifyContent: "flex-end",
        }}
      >
        <Segmented<string>
          options={[
            { value: "1", label: "1×" },
            { value: "2", label: "2×" },
            { value: "3", label: "3×" },
          ]}
          value={String(scale)}
          onValueChange={(v) => setScale(Number(v) as MinimapScale)}
          aria-label="Overview scale"
          size="sm"
        />
      </div>

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {segments.map((seg) => {
          const duration = seg.end - seg.start;
          // D-27 formula multiplied by the user-chosen scale, clamped at
          // 36 * 3 = 108 so a 60-second monologue doesn't render as a
          // skyscraper at 3x.
          const height = Math.min(
            108,
            Math.max(8, Math.min(36, duration * 1.6)) * scale,
          );
          const idx = speakerIndex.get(seg.speaker) ?? 0;
          const color = `var(--color-sp-${(idx % 5) + 1})`;
          const isActive = seg.id === activeSegId;
          // Item 9 of "things to change 2.txt": each bar shows a snippet
          // of its segment text so the overview doubles as a content
          // index. We only render the preview when the bar is tall enough
          // to fit a readable line — anything shorter than ~22px gets the
          // accessible-only label and an empty bar to preserve density.
          const showPreview = height >= 22;
          const lines = Math.max(1, Math.floor((height - 6) / 13));

          return (
            <button
              key={seg.id}
              type="button"
              aria-label={`Jump to segment at ${Math.floor(seg.start)}s`}
              aria-pressed={isActive}
              onClick={() => onJump(seg)}
              style={{
                width: "100%",
                height,
                background: color,
                borderRadius: 2,
                border: isActive
                  ? "1px solid var(--color-accent)"
                  : "1px solid transparent",
                cursor: "pointer",
                opacity: isActive ? 1 : 0.85,
                transition: "opacity 150ms, border-color 150ms",
                padding: showPreview ? "2px 6px" : 0,
                textAlign: "left",
                color: "var(--color-bg-0)",
                fontSize: 11,
                lineHeight: "13px",
                fontWeight: 500,
                overflow: "hidden",
                display: showPreview ? "-webkit-box" : "block",
                WebkitBoxOrient:
                  "vertical" as React.CSSProperties["WebkitBoxOrient"],
                WebkitLineClamp: lines,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = isActive ? "1" : "0.85";
              }}
            >
              {showPreview ? seg.text : null}
            </button>
          );
        })}

        {/* 1.5px accent playhead — D-27 + UI-SPEC §6 */}
        {totalDuration > 0 && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${playheadPct}%`,
              height: 1.5,
              background: "var(--color-accent)",
              boxShadow: "0 0 8px var(--color-accent)",
              transition: "top 100ms linear",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </aside>
  );
}
