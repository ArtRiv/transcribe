import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProcessingCard } from "@/components/transcribe/processing-card";

const file = new File([new Uint8Array(1024)], "rec.mp3", { type: "audio/mpeg" });

describe("ProcessingCard — PROG-01 stage labels", () => {
  it("renders 'Transcribing with whisper.cpp' for transcribing phase", () => {
    render(
      <ProcessingCard
        file={file}
        duration={60}
        phase="transcribing"
        uploadPct={100}
        progress={42}
        jobId="abc-12345678"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Transcribing with whisper\.cpp/)).toBeInTheDocument();
  });

  it("renders 'Diarizing with pyannote 3.4' for diarizing phase", () => {
    render(
      <ProcessingCard
        file={file}
        duration={60}
        phase="diarizing"
        uploadPct={100}
        progress={88}
        jobId="abc-12345678"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Diarizing with pyannote 3\.4/)).toBeInTheDocument();
  });
});

describe("ProcessingCard — PROG-02 progress bar", () => {
  it("renders progress with aria-valuenow reflecting prop", () => {
    render(
      <ProcessingCard
        file={file}
        duration={60}
        phase="transcribing"
        uploadPct={100}
        progress={42}
        jobId="abc-12345678"
        onCancel={() => {}}
      />,
    );
    const bars = screen.getAllByRole("progressbar");
    expect(bars.some((b) => b.getAttribute("aria-valuenow") === "42")).toBe(true);
  });
});

describe("ProcessingCard — PROG-04 queued ahead", () => {
  it("renders 'Waiting for GPU — 2 jobs ahead' when queueAhead=2", () => {
    render(
      <ProcessingCard
        file={file}
        duration={60}
        phase="queued"
        uploadPct={100}
        progress={0}
        queueAhead={2}
        jobId="abc-12345678"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Waiting for GPU — 2 jobs ahead/)).toBeInTheDocument();
  });

  it("renders singular 'job ahead' when queueAhead=1", () => {
    render(
      <ProcessingCard
        file={file}
        duration={60}
        phase="queued"
        uploadPct={100}
        progress={0}
        queueAhead={1}
        jobId="abc-12345678"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/Waiting for GPU — 1 job ahead/)).toBeInTheDocument();
  });

  it("renders plain 'Waiting for GPU' when queueAhead=0", () => {
    render(
      <ProcessingCard
        file={file}
        duration={60}
        phase="queued"
        uploadPct={100}
        progress={0}
        queueAhead={0}
        jobId="abc-12345678"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Waiting for GPU")).toBeInTheDocument();
  });
});

describe("ProcessingCard — PROG-05 cancel", () => {
  it("calls onCancel when the Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ProcessingCard
        file={file}
        duration={60}
        phase="transcribing"
        uploadPct={100}
        progress={50}
        jobId="abc-12345678"
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Cancel job/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("disables the Cancel button when phase=done", () => {
    render(
      <ProcessingCard
        file={file}
        duration={60}
        phase="done"
        uploadPct={100}
        progress={100}
        jobId="abc-12345678"
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /Cancel job/i })).toBeDisabled();
  });
});
