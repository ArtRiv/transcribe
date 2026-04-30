"use client";
import * as React from "react";
import { FileAudio, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SchematicIllustration } from "./schematic-illustration";

interface UploadZoneProps {
  file: File | null;
  onFile: (file: File) => void;
  onClear: () => void;
  onDuration?: (seconds: number) => void;
  duration?: number | null;
  validationError?: string | null;
  className?: string;
}

/** ALLOWED_EXTENSIONS mirror backend/app/routes/tus.py lines 51-64. */
const ACCEPT_HINT = "mp3 · m4a · wav · mp4 · mov · webm";

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function fmtSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Drop zone + file picker + meta probe.
 * Verbatim layout from landing.jsx lines 99-170 with keyboard a11y added
 * per RESEARCH §Pattern 8 (the spec lacks keyboard support).
 *
 * Duration probe uses an off-screen <audio preload="metadata"> element per
 * RESEARCH §Pitfall 7 — URL is revoked in cleanup AND on loadedmetadata.
 */
export function UploadZone({
  file,
  onFile,
  onClear,
  onDuration,
  duration,
  validationError,
  className,
}: UploadZoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  // Off-screen probe for file duration (RESEARCH §Pitfall 7).
  // Mounts an <audio src=ObjectURL preload="metadata">; onLoadedMetadata reads
  // duration, calls onDuration(), then revokes the URL.
  React.useEffect(() => {
    if (!file || !onDuration) return;
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = url;
    let cancelled = false;
    const handler = () => {
      if (cancelled) return;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        onDuration(audio.duration);
      }
      URL.revokeObjectURL(url);
    };
    audio.addEventListener("loadedmetadata", handler);
    return () => {
      cancelled = true;
      audio.removeEventListener("loadedmetadata", handler);
      URL.revokeObjectURL(url);
    };
  }, [file, onDuration]);

  const openPicker = React.useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  };

  // EMPTY state
  if (!file) {
    return (
      <div className={className}>
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop audio or video file or click to browse"
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openPicker();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          data-drag-over={dragOver}
          className="text-center cursor-pointer transition-all duration-150"
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "44px 22px",
            background: dragOver
              ? "var(--color-accent-soft)"
              : "var(--color-bg-2)",
            border: `1.5px dashed ${dragOver ? "var(--color-accent)" : "var(--color-line)"}`,
            borderRadius: 18,
          }}
        >
          <div className="flex flex-col items-center" style={{ gap: 18 }}>
            <SchematicIllustration />
            <div className="text-center">
              <div
                className="font-medium"
                style={{
                  color: "var(--color-fg-1)",
                  fontSize: 15,
                  marginBottom: 4,
                }}
              >
                Drop a file here, or{" "}
                <span
                  style={{
                    color: "var(--color-accent)",
                    textDecoration: "underline",
                    textUnderlineOffset: 3,
                  }}
                >
                  browse
                </span>
              </div>
              <div
                style={{
                  color: "var(--color-fg-3)",
                  fontSize: 11.5,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {ACCEPT_HINT} — up to 5 hours
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => e.stopPropagation()}
            >
              <Sparkles size={13} aria-hidden="true" />
              Use sample audio
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="audio/*,video/*"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </div>
        {validationError ? (
          <p
            role="alert"
            style={{
              marginTop: 8,
              color: "var(--color-err)",
              fontSize: 12.5,
              textAlign: "center",
            }}
          >
            {validationError}
          </p>
        ) : null}
      </div>
    );
  }

  // FILE-SELECTED state — landing.jsx lines 134-160
  return (
    <div className={className}>
      <div
        className="flex items-center gap-3"
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "20px 22px",
          background: "var(--color-bg-2)",
          border: "1px solid var(--color-line)",
          borderRadius: 18,
        }}
      >
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 42,
            height: 42,
            background: "var(--color-bg-3)",
            border: "1px solid var(--color-line)",
            borderRadius: 10,
            color: "var(--color-accent)",
          }}
        >
          <FileAudio size={20} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="truncate font-medium"
            style={{ fontSize: 14, color: "var(--color-fg-0)" }}
          >
            {file.name}
          </div>
          <div
            style={{
              color: "var(--color-fg-3)",
              fontSize: 11.5,
              fontFamily: "var(--font-mono)",
              marginTop: 2,
            }}
          >
            {fmtSize(file.size)}
            {" · "}
            {duration != null ? fmtDuration(duration) : "estimating…"}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          aria-label="Replace file"
        >
          <X size={14} aria-hidden /> Replace
        </Button>
      </div>
      {validationError ? (
        <p
          role="alert"
          style={{
            marginTop: 8,
            color: "var(--color-err)",
            fontSize: 12.5,
            textAlign: "center",
          }}
        >
          {validationError}
        </p>
      ) : null}
    </div>
  );
}
