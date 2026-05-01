"use client";
import * as React from "react";
import { PanelLeft, PanelRight, Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Kbd } from "@/components/ui/kbd";
import * as Tooltip from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n/i18n-context";

type Density = "compact" | "normal" | "comfortable";

interface EditorToolbarProps {
  density: Density;
  onDensityChange: (d: Density) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  speakersOpen: boolean;
  onToggleSpeakers: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  onExport: () => void;
}

/**
 * Editor toolbar.
 *
 * Quick task 260501-1e4 (item line 33 of Things-to-change.txt) removed the
 * Play/Pause button + scrub slider that used to live here — they duplicated
 * the bottom AudioPlayer (which has native controls + a speed picker). The
 * keyboard shortcut path in editor-client still drives audio.play()/pause()
 * directly, so removing the button does not regress that affordance.
 */
export function EditorToolbar({
  density,
  onDensityChange,
  searchQuery,
  onSearchChange,
  searchInputRef,
  speakersOpen,
  onToggleSpeakers,
  minimapOpen,
  onToggleMinimap,
  onExport,
}: EditorToolbarProps) {
  const { t } = useI18n();
  return (
    <header
      role="toolbar"
      aria-label="Editor toolbar"
      style={{
        height: 52,
        padding: "0 14px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid var(--color-line)",
        background: "var(--color-bg-1)",
      }}
    >
      {/* Speakers rail toggle */}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleSpeakers}
              aria-label={
                speakersOpen
                  ? t.editor_toggle_speakers_hide
                  : t.editor_toggle_speakers_show
              }
              aria-pressed={speakersOpen}
            >
              <PanelLeft size={14} aria-hidden />
            </Button>
          }
        />
        <Tooltip.Panel>
          {speakersOpen
            ? t.editor_toggle_speakers_hide
            : t.editor_toggle_speakers_show}
        </Tooltip.Panel>
      </Tooltip.Root>

      {/* Search — now takes more horizontal room since the Play/Pause and
          scrub slider were removed (item line 33 of Things-to-change.txt). */}
      <div
        className="relative flex items-center"
        style={{ flex: 1, maxWidth: 480 }}
      >
        <Search
          size={14}
          aria-hidden
          className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: "var(--color-fg-3)" }}
        />
        {/* Use native input so ref works — Input.tsx doesn't forward refs */}
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.editor_filter_segments}
          aria-label={t.editor_filter_segments_aria}
          className="h-[34px] bg-(--color-bg-2) border border-(--color-line) text-(--color-fg-1) text-sm placeholder:text-(--color-fg-3) rounded-(--radius-md) outline-none transition-colors focus:border-(--color-accent-line) w-full"
          style={{ paddingLeft: 28, paddingRight: 60 }}
        />
        <span
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden
        >
          <Kbd>⌘F</Kbd>
        </span>
      </div>

      {/* Density segmented control — D-26 */}
      <Segmented<Density>
        options={[
          { value: "compact", label: t.editor_density_compact },
          { value: "normal", label: t.editor_density_normal },
          { value: "comfortable", label: t.editor_density_comfy },
        ]}
        value={density}
        onValueChange={onDensityChange}
        aria-label={t.editor_density_aria}
        size="sm"
      />

      {/* Export */}
      <Button
        variant="default"
        size="sm"
        onClick={onExport}
        aria-label={t.editor_export_aria}
      >
        <Download size={12} aria-hidden /> {t.editor_export}
      </Button>

      {/* Minimap toggle */}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleMinimap}
              aria-label={
                minimapOpen
                  ? t.editor_toggle_minimap_hide
                  : t.editor_toggle_minimap_show
              }
              aria-pressed={minimapOpen}
            >
              <PanelRight size={14} aria-hidden />
            </Button>
          }
        />
        <Tooltip.Panel>
          {minimapOpen
            ? t.editor_toggle_minimap_hide
            : t.editor_toggle_minimap_show}
        </Tooltip.Panel>
      </Tooltip.Root>
    </header>
  );
}
