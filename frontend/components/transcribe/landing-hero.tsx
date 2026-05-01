"use client";
import * as React from "react";
import { Chip } from "@/components/ui/chip";
import { useI18n } from "@/lib/i18n/i18n-context";

/**
 * Hero block. The two-line copy is locale-driven: each catalog supplies
 * `hero_line_1` (plain text) and `hero_line_2` (text with optional markup —
 * see lib/i18n/types.ts for the supported tag list).
 *
 * The original implementation hard-coded the English word order
 * ("Editable, speaker-labeled transcript out.") and concatenated four
 * separate i18n keys, which forced translators into the same syntactic
 * shape and produced unnatural Portuguese ("Editável, com falantes
 * identificados transcrição sai." — clipped, ambiguous). Pulling the
 * composition into the catalog lets each locale keep its own order.
 */
const TAG_RE = /(<accent>[\s\S]*?<\/accent>|<em>[\s\S]*?<\/em>)/g;

function renderLine(line: string): React.ReactNode {
  return line.split(TAG_RE).map((part, i) => {
    if (part.startsWith("<accent>")) {
      const inner = part.slice("<accent>".length, -"</accent>".length);
      return (
        <em
          key={i}
          style={{ fontStyle: "italic", color: "var(--color-accent)" }}
        >
          {inner}
        </em>
      );
    }
    if (part.startsWith("<em>")) {
      const inner = part.slice("<em>".length, -"</em>".length);
      return (
        <em key={i} style={{ fontStyle: "italic" }}>
          {inner}
        </em>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

export function LandingHero() {
  const { t } = useI18n();
  return (
    <div
      className="flex flex-col items-center text-center"
      style={{ marginBottom: 36 }}
    >
      <Chip dotColor="var(--color-ok)" className="mb-6">
        {t.hero_status_pill}
      </Chip>

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
        {renderLine(t.hero_line_1)}
        <br />
        {renderLine(t.hero_line_2)}
      </h1>

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
