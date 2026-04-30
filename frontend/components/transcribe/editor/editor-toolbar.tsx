"use client";
import * as React from "react";
import { PanelLeft, PanelRight, Play, Pause, Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { Kbd } from "@/components/ui/kbd";
import * as Tooltip from "@/components/ui/tooltip";

type Density = "compact" | "normal" | "comfortable";

interface EditorToolbarProps {
  density: Density;
  onDensityChange: (d: Density) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  isPlaying: boolean;
  onPlayPause: () => void;
  /** Scrub position 0-100. */
  scrubPct: number;
  onScrub: (pct: number) => void;
  speakersOpen: boolean;
  onToggleSpeakers: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
  onExport: () => void;
}

export function EditorToolbar({
  density,
  onDensityChange,
  searchQuery,
  onSearchChange,
  searchInputRef,
  isPlaying,
  onPlayPause,
  scrubPct,
  onScrub,
  speakersOpen,
  onToggleSpeakers,
  minimapOpen,
  onToggleMinimap,
  onExport,
}: EditorToolbarProps) {
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
              aria-label={speakersOpen ? "Hide speakers" : "Show speakers"}
              aria-pressed={speakersOpen}
            >
              <PanelLeft size={14} aria-hidden />
            </Button>
          }
        />
        <Tooltip.Panel>Toggle speakers</Tooltip.Panel>
      </Tooltip.Root>

      {/* Play / Pause */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onPlayPause}
        aria-label={isPlaying ? "Pause" : "Play"}
        aria-pressed={isPlaying}
      >
        {isPlaying ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
      </Button>

      {/* Scrub slider — native range so keyboard nav works */}
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={scrubPct}
        onChange={(e) => onScrub(parseFloat(e.target.value))}
        aria-label="Audio position"
        className="flex-1 max-w-[280px]"
      />

      {/* Search */}
      <div className="relative flex items-center" style={{ flex: 1, maxWidth: 320 }}>
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
          placeholder="Filter segments…"
          aria-label="Filter segments"
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
          { value: "compact", label: "Compact" },
          { value: "normal", label: "Normal" },
          { value: "comfortable", label: "Comfy" },
        ]}
        value={density}
        onValueChange={onDensityChange}
        aria-label="Density"
        size="sm"
      />

      {/* Export */}
      <Button variant="default" size="sm" onClick={onExport} aria-label="Export transcript">
        <Download size={12} aria-hidden /> Export
      </Button>

      {/* Minimap toggle */}
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleMinimap}
              aria-label={minimapOpen ? "Hide minimap" : "Show minimap"}
              aria-pressed={minimapOpen}
            >
              <PanelRight size={14} aria-hidden />
            </Button>
          }
        />
        <Tooltip.Panel>Toggle minimap</Tooltip.Panel>
      </Tooltip.Root>
    </header>
  );
}
