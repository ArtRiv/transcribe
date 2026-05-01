"use client";
import * as React from "react";
import { ChevronDown, SlidersHorizontal, Info } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { Range } from "@/components/ui/range";
import { Select } from "@/components/ui/select";
import * as Tooltip from "@/components/ui/tooltip";
import { OptionRow } from "./option-row";
import type { JobOptions, PresetName } from "@/lib/job/submit";
import { useI18n, format } from "@/lib/i18n/i18n-context";
import type { Messages } from "@/lib/i18n/types";

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
 *
 * Hint for the disabled "Best" pill changed during quick task 260501-1e4 from
 * "8 GB VRAM only · ~1.4× realtime" to "~10 GB VRAM · ~1.4× realtime" — the
 * old wording was misleading because Best needs MORE than 8 GB; this host's
 * 8 GB AMD RX 6600 is the reason the preset is gated off, not the requirement.
 */
function presetOptions(
  t: Messages,
  bestUnlocked: boolean,
): Array<{
  value: PresetUiValue;
  label: string;
  hint: string;
  disabled?: boolean;
}> {
  return [
    {
      value: "fast",
      label: t.options_preset_fast,
      hint: t.options_preset_fast_hint,
    },
    {
      value: "balanced",
      label: t.options_preset_balanced,
      hint: t.options_preset_balanced_hint,
    },
    {
      value: "best",
      label: t.options_preset_best,
      hint: bestUnlocked
        ? t.options_preset_best_hint_unlocked
        : t.options_preset_best_hint_disabled,
      disabled: !bestUnlocked,
    },
  ];
}

/** Languages — UI-SPEC §13.1 list + auto-detect default. The OPTION LABELS
 *  here are the recording language (what the audio is in), separate from the
 *  UI locale. We show language names in the UI's locale per Web convention
 *  (Portuguese-speaking users see "Inglês"/"Português"). */
function languages(t: Messages, locale: "en" | "pt-BR") {
  const isPt = locale === "pt-BR";
  return [
    { value: "", label: t.options_language_auto },
    { value: "en", label: isPt ? "Inglês" : "English" },
    { value: "es", label: isPt ? "Espanhol" : "Spanish" },
    { value: "pt", label: isPt ? "Português" : "Portuguese" },
    { value: "fr", label: isPt ? "Francês" : "French" },
    { value: "de", label: isPt ? "Alemão" : "German" },
    { value: "ja", label: isPt ? "Japonês" : "Japanese" },
    { value: "zh", label: isPt ? "Chinês" : "Chinese" },
  ];
}

/** UI-SPEC §9.2 line 476 — disclosure summary text. */
function summarizeOptions(
  options: JobOptions,
  t: Messages,
  langs: ReturnType<typeof languages>,
): string {
  const presetLabel =
    PRESET_TO_UI[options.preset] === "fast"
      ? t.options_preset_fast
      : PRESET_TO_UI[options.preset] === "best"
        ? t.options_preset_best
        : t.options_preset_balanced;
  const langLabel =
    langs.find((l) => l.value === (options.language ?? ""))?.label ??
    t.options_language_auto;
  const diar = options.diarize
    ? t.options_summary_diar_on
    : t.options_summary_diar_off;
  return `${presetLabel}, ${langLabel}, ${diar}`;
}

export function OptionsPanel({
  options,
  onChange,
  bestUnlocked = false,
  defaultOpen = false,
  className,
}: OptionsPanelProps) {
  const { locale, t } = useI18n();
  const presetUi = PRESET_TO_UI[options.preset];
  // When the user picks an explicit model in the Advanced panel, the
  // preset is ignored backend-side, so we dim + disable the Quality row
  // (item 2 of "things to change 2.txt").
  const manualModel = !!options.model;
  const [open, setOpen] = React.useState(defaultOpen);
  // Advanced sub-accordion (item line 15 of Things-to-change.txt).
  // Collapsed by default — most users will not override the preset.
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const langs = React.useMemo(() => languages(t, locale), [t, locale]);
  const summary = summarizeOptions(options, t, langs);
  const presetItems = React.useMemo(
    () => presetOptions(t, bestUnlocked),
    [t, bestUnlocked],
  );

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
          <span>{t.options_label}</span>
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
          {/* OPTS-01, OPTS-02 — Quality preset.
              When Best is gated off (the common case on this 8 GB host) we
              render a small info icon next to the segmented control with a
              tooltip explaining why — item line 13 of Things-to-change.txt.
              The icon is a real button so it captures keyboard focus + the
              Tooltip primitive's aria-describedby wiring works for AT users.
              Item 2 of "things to change 2.txt": the preset row is dimmed
              + disabled when the user picks an explicit model below, since
              the preset is ignored in that case. */}
          <OptionRow
            label={t.options_quality}
            hint={t.options_quality_hint}
            disabled={manualModel}
          >
            <Segmented<PresetUiValue>
              options={presetItems.map((p) => ({
                ...p,
                disabled: p.disabled || manualModel,
              }))}
              value={presetUi}
              onValueChange={(v) =>
                onChange({ ...options, preset: UI_TO_PRESET[v] })
              }
              aria-label="Quality preset"
            />
            {!bestUnlocked ? (
              <Tooltip.Root>
                <Tooltip.Trigger
                  render={
                    <button
                      type="button"
                      aria-label={t.options_preset_best_disabled_tooltip}
                      className="inline-flex items-center justify-center rounded-full hover:bg-(--color-bg-3) cursor-help"
                      style={{
                        width: 18,
                        height: 18,
                        color: "var(--color-fg-3)",
                      }}
                    >
                      <Info size={12} aria-hidden />
                    </button>
                  }
                />
                <Tooltip.Panel className="max-w-[280px]">
                  {t.options_preset_best_disabled_tooltip}
                </Tooltip.Panel>
              </Tooltip.Root>
            ) : null}
          </OptionRow>

          {/* OPTS-05, OPTS-06 — Language */}
          <OptionRow label={t.options_language} hint={t.options_language_hint}>
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
              {langs.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </OptionRow>

          {/* OPTS-03 — Diarization */}
          <OptionRow
            label={t.options_diarization}
            hint={t.options_diarization_hint}
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
            label={t.options_speakers}
            hint={t.options_speakers_hint}
            disabled={!options.diarize}
          >
            <Range
              min={0}
              max={10}
              step={1}
              value={options.num_speakers ?? 0}
              disabled={!options.diarize}
              valueText={
                (options.num_speakers ?? 0) === 0
                  ? t.options_speakers_auto
                  : undefined
              }
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
                ? t.options_speakers_auto
                : (options.num_speakers ?? 0) === 1
                  ? t.options_speakers_one
                  : format(t.options_speakers_n, {
                      n: options.num_speakers ?? 0,
                    })}
            </span>
          </OptionRow>

          {/* Advanced sub-accordion — item line 15 of Things-to-change.txt.
              Purely additive: the model picker forwards the chosen value to
              the backend in BOTH multipart and TUS metadata via lib/job/submit
              under key "model". The backend currently ignores the field —
              landing the UI surface unblocks future per-model gating without
              another frontend redeploy. */}
          <details
            open={advancedOpen}
            onToggle={(e) =>
              setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)
            }
            style={{
              borderTop: "1px solid var(--color-line)",
              paddingTop: 12,
              marginTop: 4,
            }}
          >
            <summary
              className="cursor-pointer inline-flex items-center gap-1.5 select-none"
              style={{
                color: "var(--color-fg-2)",
                fontSize: 12.5,
                fontWeight: 500,
                listStyle: "none",
              }}
            >
              <ChevronDown
                size={12}
                aria-hidden="true"
                style={{
                  transform: advancedOpen ? "rotate(180deg)" : "rotate(-90deg)",
                  transition: "transform 150ms ease",
                }}
              />
              {t.options_advanced}
            </summary>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <OptionRow
                label={t.options_model_picker_label}
                hint={t.options_model_picker_hint}
              >
                {/* fullWidth keeps the long "— use preset —" / model labels
                    from forcing the Select wider than the OptionRow's right
                    column. The native <select> popup still shows the full
                    text on click — only the closed control is clipped. */}
                <Select
                  fullWidth
                  value={options.model ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...options,
                      model: e.target.value || undefined,
                    })
                  }
                  aria-label="Model override"
                >
                  <option value="">— use preset —</option>
                  <option value="tiny">Tiny · 1 GB · ~30× realtime</option>
                  <option value="base">Base · 1 GB · ~25× realtime</option>
                  <option value="small">
                    Small · 2 GB · ~20× realtime (Fast)
                  </option>
                  <option value="medium">Medium · 5 GB · ~10× realtime</option>
                  <option value="large-v3-turbo">
                    Large-v3-turbo · 6 GB · ~30–60× (Balanced)
                  </option>
                  <option value="large-v3" disabled>
                    Large-v3 · 10 GB (disabled — 8 GB host)
                  </option>
                </Select>
              </OptionRow>
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}
