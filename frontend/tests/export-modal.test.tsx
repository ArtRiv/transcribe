import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportModal } from "@/components/transcribe/export-modal";
import { SAMPLE_PAYLOAD } from "@/lib/mock/data";

function renderOpen() {
  return render(<ExportModal open onOpenChange={() => {}} state={SAMPLE_PAYLOAD} />);
}

describe("ExportModal — format tabs (EXPORT-01..05)", () => {
  it("renders all 5 format tabs", () => {
    renderOpen();
    expect(screen.getByRole("tab", { name: /Plain text/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /SRT/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /VTT/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Markdown/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /JSON/i })).toBeInTheDocument();
  });

  it("Markdown is the default-active tab", () => {
    renderOpen();
    expect(screen.getByRole("tab", { name: /Markdown/i })).toHaveAttribute("aria-selected", "true");
  });

  it("preview pane updates when format changes (EXPORT-07)", async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByRole("tab", { name: /JSON/i }));
    const preview = screen.getByRole("tabpanel");
    // JSON renderer outputs valid JSON
    expect(() => JSON.parse(preview.textContent ?? "")).not.toThrow();
  });
});

describe("ExportModal — timestamps locked for SRT/VTT (UI-SPEC §9.5)", () => {
  it("disables the timestamps switch when SRT is active", async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByRole("tab", { name: /SRT/i }));
    const switches = screen.getAllByRole("switch");
    const tsSwitch = switches.find((sw) => sw.getAttribute("aria-label")?.includes("timestamps"));
    expect(tsSwitch).toBeDisabled();
  });

  it("shows 'Required by SRT' hint", async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByRole("tab", { name: /SRT/i }));
    expect(screen.getByText(/Required by SRT/)).toBeInTheDocument();
  });

  it("disables the timestamps switch when VTT is active", async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByRole("tab", { name: /VTT/i }));
    const switches = screen.getAllByRole("switch");
    const tsSwitch = switches.find((sw) => sw.getAttribute("aria-label")?.includes("timestamps"));
    expect(tsSwitch).toBeDisabled();
  });
});

describe("ExportModal — copy (EXPORT-06)", () => {
  it("calls navigator.clipboard.writeText with the preview content", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // jsdom: navigator.clipboard is undefined — stub the whole clipboard object.
    // Note: userEvent sends pointer events that Base UI intercepts; fireEvent.click
    // correctly triggers the React onClick handler for Base UI buttons.
    vi.stubGlobal("navigator", {
      ...window.navigator,
      clipboard: { writeText },
    });
    renderOpen();
    fireEvent.click(screen.getByRole("button", { name: /Copy to clipboard/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });
});

describe("ExportModal — download", () => {
  it("renders the Download .md button by default", () => {
    renderOpen();
    expect(screen.getByRole("button", { name: /Download md/i })).toBeInTheDocument();
  });

  it("changes filename + extension when format switches", async () => {
    const user = userEvent.setup();
    renderOpen();
    await user.click(screen.getByRole("tab", { name: /JSON/i }));
    expect(screen.getByRole("button", { name: /Download json/i })).toBeInTheDocument();
    // Filename in footer
    expect(screen.getByText(/transcript\.json · 18 segments/)).toBeInTheDocument();
  });
});
