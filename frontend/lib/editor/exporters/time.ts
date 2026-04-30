// Time formatting helpers — verbatim port from claude-design-code/transcribe/src/data.jsx
// lines 33-63 with TypeScript types layered in.

/** Format seconds as "mm:ss". Hours overflow into minutes (no HH component). */
export const fmtTime = (s: number): string => {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

/** Format seconds as "HH:MM:SS,mmm" (SRT spec — comma decimal separator). */
export const fmtSrtTime = (s: number): string => {
  // Use Math.round on total milliseconds to avoid floating-point drift
  // (e.g. 7.6 → 7600 ms, not 7599 ms).
  const totalMs = Math.round(s * 1000);
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const r = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

/** Format seconds as "HH:MM:SS.mmm" (WebVTT spec — period decimal separator). */
export const fmtVttTime = (s: number): string => fmtSrtTime(s).replace(",", ".");
