"use client";
import * as React from "react";

/**
 * Static 280×84 SVG illustration — verbatim port from landing.jsx lines 333-369.
 * The illustration is decorative; aria-hidden keeps it out of the a11y tree.
 */
export function SchematicIllustration() {
  return (
    <svg
      aria-hidden="true"
      width="280"
      height="84"
      viewBox="0 0 280 84"
      fill="none"
      style={{ color: "var(--color-fg-3)" }}
    >
      {/* Left: stylized waveform as vertical bars */}
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55">
        {[14, 28, 22, 36, 18, 30, 14, 26, 36, 22, 16, 28, 20].map((h, i) => (
          <line
            key={i}
            x1={6 + i * 7}
            x2={6 + i * 7}
            y1={42 - h / 2}
            y2={42 + h / 2}
          />
        ))}
      </g>

      {/* Center arrow */}
      <g
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      >
        <line x1="108" y1="42" x2="148" y2="42" />
        <polyline points="142,38 148,42 142,46" />
      </g>

      {/* Right: three speaker rows with text-block lines */}
      <g>
        {[
          { y: 14, dot: "var(--color-sp-1)", w: [54, 70, 38] },
          { y: 38, dot: "var(--color-sp-2)", w: [42, 64, 60] },
          { y: 62, dot: "var(--color-sp-3)", w: [70, 38, 50] },
        ].map((row, i) => (
          <g key={i}>
            <circle cx="160" cy={row.y + 8} r="4" fill={row.dot} opacity="0.85" />
            {row.w.map((w, j) => {
              const x =
                174 +
                (j === 0
                  ? 0
                  : row.w.slice(0, j).reduce((a: number, b: number) => a + b, 0) + j * 4);
              return (
                <rect
                  key={j}
                  x={x}
                  y={row.y + 4}
                  width={w}
                  height={8}
                  rx="2"
                  fill="currentColor"
                  opacity={0.18 + j * 0.05}
                />
              );
            })}
          </g>
        ))}
      </g>
    </svg>
  );
}
