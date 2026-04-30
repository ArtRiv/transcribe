"use client";
import * as React from "react";
import { Upload } from "lucide-react";
import { useEditorStore } from "@/lib/editor/store";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";

type PlaybackRate = "1" | "1.25" | "1.5" | "2";

interface AudioPlayerProps {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  jobId: string;
  onTimeUpdate?: (seconds: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** Called when the user re-uploads a file after the source was lost on reload. */
  onRebindFile?: (file: File) => void;
  className?: string;
}

/**
 * Audio player with Blob URL + playback rate switcher (VIEW-03..05).
 *
 * D-14/D-15: createObjectURL on file mount, revokeObjectURL on unmount AND
 * file change (Pitfall 4 — memory leak on navigation).
 *
 * D-14 graceful degrade: if File ref missing on full page reload, render
 * the "Audio source lost" pill (UI-SPEC §13.3) with re-upload button.
 *
 * Playback rate persisted to localStorage.transcribe.playbackRate per
 * UI-SPEC §10.6.
 */
export function AudioPlayer({
  audioRef,
  jobId,
  onTimeUpdate,
  onPlayingChange,
  onRebindFile,
  className,
}: AudioPlayerProps) {
  const file = useEditorStore((s) => s.fileRefByJobId[jobId]);
  const [src, setSrc] = React.useState<string | null>(null);
  const [rate, setRate] = React.useState<PlaybackRate>(() => {
    // Persist user preference across reloads (UI-SPEC §10.6).
    try {
      const stored = window.localStorage.getItem("transcribe.playbackRate");
      if (stored && ["1", "1.25", "1.5", "2"].includes(stored)) {
        return stored as PlaybackRate;
      }
    } catch {
      // SSR or private mode — fall through to default.
    }
    return "1";
  });
  const reuploadRef = React.useRef<HTMLInputElement>(null);

  // D-14/D-15: create Blob URL when File ref changes, revoke on change + unmount.
  React.useEffect(() => {
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear stale Blob URL when File ref unset
      setSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: setSrc cascades into <audio src> binding
    setSrc(url);
    // Revoke on unmount AND on file change — Pitfall 4 (leak on navigation).
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  // Apply playback rate to <audio> whenever rate or src changes.
  React.useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.playbackRate = parseFloat(rate);
  }, [audioRef, rate, src]);

  const onRateChange = (r: PlaybackRate) => {
    setRate(r);
    try {
      window.localStorage.setItem("transcribe.playbackRate", r);
    } catch {
      /* Safari private mode quota = 0 — swallow */
    }
  };

  // D-14 graceful degrade — File ref missing after full page reload.
  if (!file) {
    return (
      <div
        role="status"
        className={className}
        style={{
          padding: 12,
          border: "1px dashed var(--color-line)",
          borderRadius: "var(--radius-md)",
          fontSize: 12.5,
          color: "var(--color-fg-3)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <span style={{ flex: 1 }}>
          Audio source lost on reload — re-upload to enable scrubbing.
        </span>
        <input
          ref={reuploadRef}
          type="file"
          accept="audio/*,video/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && onRebindFile) onRebindFile(f);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => reuploadRef.current?.click()}
          aria-label="Upload again"
        >
          <Upload size={12} aria-hidden /> Upload again
        </Button>
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ display: "flex", alignItems: "center", gap: 12 }}
    >
      <audio
        ref={audioRef}
        src={src ?? undefined}
        preload="metadata"
        controls
        onPlay={() => onPlayingChange?.(true)}
        onPause={() => onPlayingChange?.(false)}
        onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
        style={{ flex: 1, height: 32 }}
      />
      {/* VIEW-04: 4 playback rates with localStorage persistence */}
      <Segmented<PlaybackRate>
        options={[
          { value: "1", label: "1×" },
          { value: "1.25", label: "1.25×" },
          { value: "1.5", label: "1.5×" },
          { value: "2", label: "2×" },
        ]}
        value={rate}
        onValueChange={onRateChange}
        aria-label="Playback rate"
        size="sm"
      />
    </div>
  );
}
