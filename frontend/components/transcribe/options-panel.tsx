"use client";
import * as React from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Range } from "@/components/ui/range";
import { Select } from "@/components/ui/select";
import { OptionRow } from "./option-row";
import type { JobOptions, PresetName } from "@/lib/job/submit";

interface OptionsPanelProps {
  options: JobOptions;
  onChange: (options: JobOptions) => void;
  /**
   * Whether the Best preset is unlocked.
   * Phase 3: false (OPTS-07 gate). Phase 4 reads /readyz.presets to enable.
   */
  bestUnlocked?: boolean;
  /**
   * Initial open state for the disclosure. Production default = false (UI-SPEC §9.2).
   * Tests pass `defaultOpen` so the rows are queryable without simulating a click.
   */
  defaultOpen?: boolean;
  className?: string;
}

type PresetUiValue = "fast" | "balanced" | "best";

/** Map from UI segmented value to backend PresetName. */
const UI_TO_PRESET: Record<PresetUiValue, PresetName> = {
  fast: "fast",
  balanced: "average",
  best: "slow",
};

/** Map from backend PresetName to UI segmented value. */
const PRESET_TO_UI: Record<PresetName, PresetUiValue> = {
  fast: "fast",
  average: "balanced",
  average_turbo: "balanced",
  slow: "best",
};

/**
 * Quality preset options — UI-SPEC §13.1 hints + UI-SPEC §10.2 value mapping.
 * Best is gated off in Phase 3 (OPTS-07); Phase 4 unlocks via bestUnlocked prop.
 */
function presetOptions(bestUnlocked: boolean): Array<{
  value: PresetUiValue;
  label: string;
  hint: string;
  disabled?: boolean;
}> {
  return [
    { value: "fast", label: "Fast", hint: "tiny, ~10× realtime" },
    { value: "balanced", label: "Balanced", hint: "small, ~3× realtime" },
    {
      value: "best",
      label: "Best",
      hint: bestUnlocked ? "large-v3" : "8 GB VRAM only · ~1.4× realtime",
      disabled: !bestUnlocked,
    },
  ];
}

/** Languages — UI-SPEC §13.1 list + auto-detect default. */
const LANGUAGES = [
  { value: "", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
];

/** UI-SPEC §9.2 line 476 — disclosure summary text. */
function summarizeOptions(options: JobOptions): string {
  const presetLabel =
    PRESET_TO_UI[options.preset] === "fast"
      ? "Fast"
      : PRESET_TO_UI[options.preset] === "best"
        ? "Best"
        : "Balanced";
  const langLabel =
    LANGUAGES.find((l) => l.value === (options.language ?? ""))?.label ??
    "Auto-detect";
  return `${presetLabel}, ${langLabel}, diarization ${options.diarize ? "on" : "off"}`;
}

export function OptionsPanel({
  options,
  onChange,
  bestUnlocked = false,
  defaultOpen = false,
  className,
}: OptionsPanelProps) {
  const presetUi = PRESET_TO_UI[options.preset];
  const [open, setOpen] = React.useState(defaultOpen);
  const summary = summarizeOptions(options);

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="options-panel-content"
        className="w-full inline-flex items-center justify-between bg-transparent text-(--color-fg-2) hover:bg-(--color-bg-3) rounded-md transition-colors"
        style={{ height: 32, padding: "0 8px", fontSize: 13 }}
      >
        <span className="inline-flex items-center" style={{ gap: 7 }}>
          <SlidersHorizontal size={14} aria-hidden="true" />
          <span>Options</span>
          <span
            style={{
              color: "var(--color-fg-4)",
              fontWeight: 400,
              fontSize: 12,
            }}
          >
            — {summary}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 150ms ease",
          }}
        />
      </button>
      {open ? (
        <div
          id="options-panel-content"
          style={{
            marginTop: 10,
            background: "var(--color-bg-2)",
            border: "1px solid var(--color-line)",
            borderRadius: "var(--radius-lg)",
            padding: 16,
            display: "flex",
            flexDirection: "column",
            gap: 12,
            animation: "fade 240ms ease",
          }}
        >
          {/* OPTS-01, OPTS-02 — Quality preset */}
          <OptionRow label="Quality" hint="Choose speed vs accuracy">
            <Segmented<PresetUiValue>
              options={presetOptions(bestUnlocked)}
              value={presetUi}
              onValueChange={(v) =>
                onChange({ ...options, preset: UI_TO_PRESET[v] })
              }
              aria-label="Quality preset"
            />
          </OptionRow>

          {/* OPTS-05, OPTS-06 — Language */}
          <OptionRow
            label="Language"
            hint="Auto-detect works for 90+ languages."
          >
            <Select
              value={options.language ?? ""}
              onChange={(e) =>
                onChange({
                  ...options,
                  language: e.target.value || undefined,
                })
              }
              aria-label="Spoken language"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </OptionRow>

          {/* OPTS-03 — Diarization */}
          <OptionRow
            label="Diarization"
            hint="Splits the transcript into who-said-what segments using pyannote."
          >
            <Switch
              checked={options.diarize}
              onCheckedChange={(checked) =>
                onChange({ ...options, diarize: checked })
              }
              aria-label="Enable diarization"
            />
          </OptionRow>

          {/* OPTS-04 — Estimated speakers (disabled when diarize off) */}
          <OptionRow
            label="Estimated speakers"
            hint="Leave on Auto unless you know exactly how many people are on the recording."
            disabled={!options.diarize}
          >
            <Range
              min={0}
              max={10}
              step={1}
              value={options.num_speakers ?? 0}
              disabled={!options.diarize}
              valueText={(options.num_speakers ?? 0) === 0 ? "Auto" : undefined}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                onChange({ ...options, num_speakers: n });
              }}
              aria-label="Number of speakers"
              style={{ flex: 1, minWidth: 120 }}
            />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: "var(--color-fg-2)",
                minWidth: 56,
                textAlign: "right",
              }}
            >
              {(options.num_speakers ?? 0) === 0
                ? "Auto"
                : `${options.num_speakers} speaker${options.num_speakers === 1 ? "" : "s"}`}
            </span>
          </OptionRow>
        </div>
      ) : null}
    </div>
  );
}
