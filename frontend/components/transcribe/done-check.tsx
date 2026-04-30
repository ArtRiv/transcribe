"use client";
import * as React from "react";

/** 22×22 animated checkmark — port from processing.jsx lines 331-344.
 *  Uses @keyframes drawCheck from globals.css (350ms ease-out). */
export function DoneCheck() {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flex: "0 0 auto" }}
    >
      <circle cx="11" cy="11" r="10" fill="var(--color-accent)" />
      <path
        d="M6 11.5 9.5 15 16 8"
        stroke="oklch(0.20 0.020 70)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray="20"
        strokeDashoffset="20"
        style={{ animation: "drawCheck 350ms ease-out 0.1s forwards" }}
      />
    </svg>
  );
}
