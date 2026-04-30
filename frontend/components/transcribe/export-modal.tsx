"use client";
import * as React from "react";
import { Copy, Download, Check, X } from "lucide-react";
import * as Dialog from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import {
  renderTxt,
  renderSrt,
  renderVtt,
  renderMd,
  renderJson,
  type ExportOptions,
} from "@/lib/editor/exporters";
import type { EditorState } from "@/lib/editor/reducer";

type Format = "txt" | "srt" | "vtt" | "md" | "json";

const TABS: Array<{ value: Format; label: string; ext: string }> = [
  { value: "txt", label: "Plain text", ext: "txt" },
  { value: "srt", label: "SRT", ext: "srt" },
  { value: "vtt", label: "VTT", ext: "vtt" },
  { value: "md", label: "Markdown", ext: "md" },
  { value: "json", label: "JSON", ext: "json" },
];

const INFO_BODY: Record<Format, string> = {
  txt: "Plain reading — clean and copyable.",
  srt: "Drop into video players or YouTube.",
  vtt: "Drop into video players or YouTube.",
  md: "Renders nicely in any Markdown editor.",
  json: "Structured data — paste into another tool.",
};

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: EditorState;
  defaultTitle?: string;
}

export function ExportModal({
  open,
  onOpenChange,
  state,
  defaultTitle,
}: ExportModalProps) {
  const [format, setFormat] = React.useState<Format>("md");
  const [opts, setOpts] = React.useState<ExportOptions>({
    includeSpeakers: true,
    includeTimestamps: true,
    speakerNameFmt: "first",
  });
  const [copied, setCopied] = React.useState(false);

  // SRT/VTT lock timestamps on (UI-SPEC §9.5)
  const timestampsLocked = format === "srt" || format === "vtt";
  const effectiveOpts: ExportOptions = timestampsLocked
    ? { ...opts, includeTimestamps: true }
    : opts;

  const preview = React.useMemo(() => {
    switch (format) {
      case "txt":
        return renderTxt(state, effectiveOpts);
      case "srt":
        return renderSrt(state, effectiveOpts);
      case "vtt":
        return renderVtt(state, effectiveOpts);
      case "md":
        return renderMd(state, effectiveOpts, defaultTitle);
      case "json":
        return renderJson(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, state, effectiveOpts, defaultTitle]);

  const currentTab = TABS.find((t) => t.value === format)!;
  const ext = currentTab.ext;
  const filename = `transcript.${ext}`;
  const sizeKb = (new Blob([preview]).size / 1024).toFixed(1);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(preview);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* swallow — clipboard permission denied */
    }
  };

  const onDownload = () => {
    const blob = new Blob([preview], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a tick so the download has a chance to start.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Panel
        style={{
          width: "min(960px, 100%)",
          height: "min(620px, 100%)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-line)",
          }}
        >
          <div>
            <Dialog.Title
              id="export-title"
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--color-fg-0)",
                margin: 0,
              }}
            >
              Export transcript
            </Dialog.Title>
            <Dialog.Description
              style={{
                fontSize: 11.5,
                color: "var(--color-fg-3)",
                marginTop: 2,
                margin: 0,
              }}
            >
              All formats render in the browser — instant, no upload
            </Dialog.Description>
          </div>
          <div style={{ flex: 1 }} />
          <Dialog.Close
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
              >
                <X size={14} aria-hidden />
              </Button>
            }
          />
        </div>

        {/* Format tabs */}
        <div
          role="tablist"
          aria-label="Export format"
          style={{
            display: "flex",
            padding: "0 20px",
            borderBottom: "1px solid var(--color-line)",
            gap: 2,
          }}
        >
          {TABS.map((t) => {
            const active = t.value === format;
            return (
              <button
                key={t.value}
                role="tab"
                aria-selected={active}
                aria-controls="export-preview"
                onClick={() => setFormat(t.value)}
                onKeyDown={(e) => {
                  // Arrow Left/Right cycles per UI-SPEC §12.1
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const idx = TABS.findIndex((x) => x.value === format);
                    const next =
                      e.key === "ArrowRight"
                        ? (idx + 1) % TABS.length
                        : (idx - 1 + TABS.length) % TABS.length;
                    setFormat(TABS[next]!.value);
                  }
                }}
                style={{
                  appearance: "none" as const,
                  border: 0,
                  padding: "12px 14px",
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  background: "transparent",
                  color: active ? "var(--color-fg-0)" : "var(--color-fg-3)",
                  borderBottom: `2px solid ${active ? "var(--color-accent)" : "transparent"}`,
                  cursor: "pointer",
                  transition: "150ms",
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Body: sidebar + preview */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "260px 1fr",
          }}
        >
          {/* Sidebar */}
          <div
            style={{
              padding: "20px 18px",
              borderRight: "1px solid var(--color-line)",
              display: "flex",
              flexDirection: "column",
              gap: 18,
              overflow: "auto",
            }}
          >
            {/* Speakers toggle */}
            <div className="flex items-start gap-2.5">
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: "var(--color-fg-1)",
                  }}
                >
                  Include speaker labels
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--color-fg-3)",
                    marginTop: 2,
                  }}
                >
                  Prefix each segment with the speaker&apos;s name
                </div>
              </div>
              <Switch
                checked={opts.includeSpeakers}
                onCheckedChange={(v) =>
                  setOpts({ ...opts, includeSpeakers: v })
                }
                aria-label="Include speaker labels"
              />
            </div>

            {/* Timestamps toggle (locked for SRT/VTT) */}
            <div
              className="flex items-start gap-2.5"
              style={{ opacity: timestampsLocked ? 0.55 : 1 }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: "var(--color-fg-1)",
                  }}
                >
                  Include timestamps
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--color-fg-3)",
                    marginTop: 2,
                  }}
                >
                  {timestampsLocked
                    ? `Required by ${format.toUpperCase()}`
                    : "Show start time on each segment"}
                </div>
              </div>
              <Switch
                checked={effectiveOpts.includeTimestamps}
                onCheckedChange={(v) =>
                  setOpts({ ...opts, includeTimestamps: v })
                }
                disabled={timestampsLocked}
                aria-label="Include timestamps"
              />
            </div>

            {/* Speaker name format */}
            <div className="flex flex-col gap-2">
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: "var(--color-fg-1)",
                }}
              >
                Speaker name format
              </div>
              <Segmented
                options={[
                  { value: "initials", label: "M.O." },
                  { value: "first", label: "Maya" },
                  { value: "full", label: "Maya Okafor" },
                ]}
                value={opts.speakerNameFmt}
                onValueChange={(v) =>
                  setOpts({
                    ...opts,
                    speakerNameFmt: v as ExportOptions["speakerNameFmt"],
                  })
                }
                aria-label="Speaker name format"
                size="sm"
              />
            </div>

            {/* Info card */}
            <div
              style={{
                marginTop: "auto",
                padding: 12,
                background: "var(--color-bg-1)",
                border: "1px solid var(--color-line-soft)",
                borderRadius: "var(--radius-md)",
                fontSize: 11,
                color: "var(--color-fg-3)",
                lineHeight: 1.5,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 3,
                  color: "var(--color-fg-2)",
                  fontWeight: 500,
                }}
              >
                Client-side
              </div>
              {INFO_BODY[format]}
            </div>
          </div>

          {/* Preview */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              background: "var(--color-bg-1)",
              minHeight: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 16px",
                borderBottom: "1px solid var(--color-line)",
                fontSize: 11,
                color: "var(--color-fg-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              <span>{filename}</span>
              <span style={{ flex: 1 }} />
              <span>
                {preview.length.toLocaleString()} chars · {sizeKb} KB
              </span>
            </div>
            <pre
              id="export-preview"
              role="tabpanel"
              style={{
                flex: 1,
                margin: 0,
                padding: "16px 20px",
                fontSize: 12,
                lineHeight: 1.65,
                fontFamily: "var(--font-mono)",
                color: "var(--color-fg-1)",
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {preview}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 20px",
            borderTop: "1px solid var(--color-line)",
          }}
        >
          <span
            style={{
              fontSize: 11.5,
              color: "var(--color-fg-3)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {filename} · {state.segments.length} segments
          </span>
          <div style={{ flex: 1 }} />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCopy}
              aria-label="Copy to clipboard"
            >
              {copied ? (
                <Check size={13} aria-hidden />
              ) : (
                <Copy size={13} aria-hidden />
              )}
              {copied ? "Copied" : "Copy to clipboard"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onDownload}
              aria-label={`Download ${ext}`}
            >
              <Download size={13} aria-hidden /> Download .{ext}
            </Button>
          </div>
        </div>
      </Dialog.Panel>
    </Dialog.Root>
  );
}
