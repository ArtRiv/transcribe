import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProcessingCard } from "@/components/transcribe/processing-card";

const file = new File([new Uint8Array(1024)], "rec.mp3", { type: "audio/mpeg" });

describe("ProcessingCard — CORE-09 error surface", () => {
  it("renders the error detail in --color-err style and removes the progress bar", () => {
    const { container } = render(
      <ProcessingCard
        file={file}
        duration={60}
        phase="failed"
        uploadPct={100}
        progress={42}
        jobId="abc-12345678"
        error="Mock failure: VAD timeout"
        onCancel={() => {}}
      />,
    );
    // Detail text present + styled with --color-err
    expect(screen.getByText(/Mock failure: VAD timeout/)).toBeInTheDocument();
    const errEl = screen.getByText(/Mock failure: VAD timeout/) as HTMLElement;
    expect(errEl.style.color).toContain("color-err");
    // No PhaseRow progress bar in the failed mode (the file-card chunked bar may still be present
    // for the upload, but the PhaseRow's bar is suppressed).
    const phaseBars = container.querySelectorAll(
      '[role="progressbar"][aria-label*="Transcrib"], [role="progressbar"][aria-label*="Diariz"], [role="progressbar"][aria-label*="failed"]',
    );
    expect(phaseBars.length).toBe(0);
  });

  it("shows the failed title 'Transcription failed' (CORE-09 stage label)", () => {
    render(
      <ProcessingCard
        file={file}
        duration={60}
        phase="failed"
        uploadPct={100}
        progress={42}
        jobId="abc-12345678"
        error="Mock failure"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Transcription failed/)).toBeInTheDocument();
  });
});
