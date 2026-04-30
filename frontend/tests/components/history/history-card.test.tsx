// Unit tests for frontend/components/transcribe/history/transcript-card.tsx
// (Plan 04-07 Task 2).
// Tests: rendering, duration formatting, status pill, delete callback, rename callback.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TranscriptCard } from "@/components/transcribe/history/transcript-card";
import type { TranscriptListItem } from "@/lib/history/queries";

const BASE_ROW: TranscriptListItem = {
  id: "row-uuid-1234",
  title: "My Meeting Recording",
  created_at: "2026-04-01T10:00:00Z",
  duration_sec: 2647,   // 44:07
  language: "en",
  diarized: true,
};

describe("TranscriptCard", () => {
  it("renders title via EditableText", () => {
    render(
      <TranscriptCard
        transcript={BASE_ROW}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("My Meeting Recording")).toBeInTheDocument();
  });

  it("renders duration formatted (44:07 for 2647 seconds)", () => {
    render(
      <TranscriptCard
        transcript={BASE_ROW}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/44:07/)).toBeInTheDocument();
  });

  it("clicking trash icon calls onDelete prop", () => {
    const onDelete = vi.fn();
    render(
      <TranscriptCard
        transcript={BASE_ROW}
        onRename={vi.fn()}
        onDelete={onDelete}
      />,
    );
    const trashBtn = screen.getByRole("button", { name: /delete/i });
    fireEvent.click(trashBtn);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("EditableText onChange propagates to onRename prop", () => {
    const onRename = vi.fn();
    render(
      <TranscriptCard
        transcript={BASE_ROW}
        onRename={onRename}
        onDelete={vi.fn()}
      />,
    );
    // The EditableText renders a contentEditable div; simulate blur with new content
    const editable = screen.getByRole("textbox");
    // Set textContent then fire blur
    editable.textContent = "Renamed Title";
    fireEvent.blur(editable);
    expect(onRename).toHaveBeenCalledWith("Renamed Title");
  });

  it("renders without crashing when title is null", () => {
    render(
      <TranscriptCard
        transcript={{ ...BASE_ROW, title: null }}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });
});
