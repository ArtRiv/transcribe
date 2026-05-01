"use client";
import * as React from "react";
import { Chip } from "@/components/ui/chip";
import { useI18n } from "@/lib/i18n/i18n-context";

/**
 * Hero block — verbatim port from spec landing.jsx lines 51-97.
 * Copy migrated to i18n catalog (quick task 260501-1e4 Task 3); the English
 * strings remain byte-identical to the original spec wording so existing
 * landing.test.tsx assertions still pass under the default `en` locale.
 * Status pill version numbers updated to Phase 02 actuals
 * (pyannote 3.4 / whisper.cpp v1.8) per CONTEXT <specifics>.
 */
export function LandingHero() {
  const { t } = useI18n();
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{ marginBottom: 36 }}
    >
      {/* Status pill — UI-SPEC §13.1; live-dot uses --color-ok per UI-SPEC §4 */}
      <Chip dotColor="var(--color-ok)" className="mb-6">
        {t.hero_status_pill}
      </Chip>

      {/* Hero (Fraunces 38-64 px clamp) — italic accent words per UI-SPEC §3 */}
      <h1
        className="font-serif"
        style={{
          fontSize: "clamp(38px, 8vw, 64px)",
          lineHeight: 0.92,
          letterSpacing: "1.5px",
          color: "var(--color-fg-0)",
          fontWeight: 400,
          margin: 0,
        }}
      >
        {t.hero_long_audio_in}
        <br />
        <em
          style={{
            fontStyle: "italic",
            color: "var(--color-accent)",
          }}
        >
          {t.hero_editable}
        </em>
        ,{" "}
        <em
          style={{
            fontStyle: "italic",
          }}
        >
          {t.hero_speaker_labeled}
        </em>{" "}
        {t.hero_transcript_out}
      </h1>

      {/* Sub-copy — UI-SPEC §13.1 (Inter 15px) */}
      <p
        style={{
          fontSize: 15,
          lineHeight: 1.55,
          marginTop: 24,
          maxWidth: 520,
          color: "var(--color-fg-3)",
        }}
      >
        {t.hero_sub}
      </p>
    </div>
  );
}

/**
 * Privacy posture footer (SEC-09).
 * Spec wording is locked — DO NOT change. Not localized: the line is the
 * developer's own voice and translating it loses the joke.
 */
export function LandingFooter() {
  return (
    <footer
      className="text-center"
      style={{ padding: "20px 24px 24px", color: "var(--color-fg-4)" }}
    >
      <p style={{ fontStyle: "italic", fontSize: 12.5, lineHeight: 1.4 }}>
        Public URL works only while my home PC is awake — that&apos;s a feature,
        not a bug.
      </p>
    </footer>
  );
}
