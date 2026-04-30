/**
 * Pure HTML-escape utility for XSS-safe innerHTML injection.
 * Used by EditableText before injecting search highlights via innerHTML.
 * Plan 03-10 owns this file; Plan 03-11 creates it as a Rule 3 stub.
 *
 * Escapes: & < > " '
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
