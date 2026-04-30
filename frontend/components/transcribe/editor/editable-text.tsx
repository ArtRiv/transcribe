"use client";
import * as React from "react";
import { escapeHtml } from "@/lib/utils/escape-html";

interface EditableTextProps {
  text: string;
  onChange: (text: string) => void;
  /** Search query — when non-empty AND element not focused, wraps matches in <mark>. */
  highlight?: string;
  className?: string;
  style?: React.CSSProperties;
  /** ARIA label override; defaults to "Segment text". */
  ariaLabel?: string;
}

/**
 * Cursor-preserving contentEditable primitive.
 *
 * RESEARCH §Pattern 6: re-set DOM textContent only when external text
 * differs AND the element is NOT focused. Without the activeElement guard,
 * StrictMode's double-effect would overwrite focused content (Pitfall 5).
 *
 * SECURITY (RESEARCH §Security Domain): the search-highlight branch writes
 * to innerHTML via regex.replace. We escape user-supplied text first so a
 * malicious segment text containing HTML cannot execute when highlighted.
 *
 * Spec source: editor.jsx lines 427-478 (port verbatim with React 19 ref + escape fix).
 */
export function EditableText({
  text,
  onChange,
  highlight,
  className,
  style,
  ariaLabel = "Segment text",
}: EditableTextProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const lastTextRef = React.useRef(text);

  // Re-set DOM textContent only when external text changed AND element isn't focused.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (lastTextRef.current === text) return;
    // THE critical guard — without this, focused typing gets overwritten.
    if (document.activeElement === el) return;
    el.textContent = text;
    lastTextRef.current = text;
  }, [text]);

  // Render highlight markup when not focused & search active.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    const q = highlight?.trim();
    if (q) {
      // SECURITY FIX (PATTERNS §editable-text.tsx + RESEARCH §Security Domain):
      // escape user text BEFORE regex.replace — closes XSS by construction.
      const safeText = escapeHtml(text);
      const safeQuery = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(${safeQuery})`, "gi");
      el.innerHTML = safeText.replace(
        re,
        `<mark style="background:var(--color-accent-soft);color:var(--color-fg-0);padding:0 2px;border-radius:3px;">$1</mark>`,
      );
    } else {
      el.textContent = text;
    }
  }, [text, highlight]);

  return (
    <div
      ref={ref}
      className={`editable ${className ?? ""}`}
      style={{
        outline: "none",
        cursor: "text",
        whiteSpace: "pre-wrap",
        ...style,
      }}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-multiline="true"
      aria-label={ariaLabel}
      onBlur={(e) => {
        const t = e.currentTarget.textContent ?? "";
        lastTextRef.current = t;
        if (t !== text) onChange(t);
      }}
      onKeyDown={(e) => {
        // Allow native browser undo; stop propagation so a global Cmd+Z handler
        // (Plan 03-11) doesn't intercept.
        if ((e.metaKey || e.ctrlKey) && e.key === "z") e.stopPropagation();
        if (e.key === "Escape") (e.currentTarget as HTMLDivElement).blur();
      }}
    />
  );
}
