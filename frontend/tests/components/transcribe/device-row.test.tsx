/**
 * device-row.test.tsx
 *
 * Tests for DeviceRow component (08-08 Task 2).
 * Verifies inline-confirm Unpair flow per UI-SPEC /account/devices §"Unpair" table.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DeviceRow } from "@/components/transcribe/device-row";

const device = {
  name: "arthurs-macbook",
  gpu: "RX 6600 (Vulkan)",
  last_seen: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
};

describe("DeviceRow — layout", () => {
  it("renders device name and Unpair button", () => {
    render(<DeviceRow device={device} onUnpair={async () => ({ ok: true })} />);
    expect(screen.getByText("arthurs-macbook")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unpair/ })).toBeInTheDocument();
  });

  it("renders relative time for last_seen", () => {
    render(<DeviceRow device={device} onUnpair={async () => ({ ok: true })} />);
    // Should contain "ago" for relative time
    expect(screen.getByText(/ago/)).toBeInTheDocument();
  });
});

describe("DeviceRow — unpair inline confirm (UI-SPEC §Interaction Contracts)", () => {
  it("clicking Unpair shows inline 'Are you sure? Unpair' NOT a modal", () => {
    render(<DeviceRow device={device} onUnpair={async () => ({ ok: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Unpair$/ }));
    // Inline confirm appears — no dialog/modal role
    expect(screen.getByRole("button", { name: /Are you sure\? Unpair/ })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancel restores original Unpair button", () => {
    render(<DeviceRow device={device} onUnpair={async () => ({ ok: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /^Unpair$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    // Back to original state
    expect(screen.getByRole("button", { name: /^Unpair$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Are you sure/ })).toBeNull();
  });

  it("confirm Unpair calls onUnpair", async () => {
    const onUnpair = vi.fn().mockResolvedValue({ ok: true });
    render(<DeviceRow device={device} onUnpair={onUnpair} />);
    fireEvent.click(screen.getByRole("button", { name: /^Unpair$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Are you sure\? Unpair/ }));
    await waitFor(() => expect(onUnpair).toHaveBeenCalledOnce());
  });

  it("on error, shows error message", async () => {
    const onUnpair = vi.fn().mockResolvedValue({ ok: false, error: "Server error" });
    render(<DeviceRow device={device} onUnpair={onUnpair} />);
    fireEvent.click(screen.getByRole("button", { name: /^Unpair$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Are you sure\? Unpair/ }));
    await waitFor(() => expect(screen.getByText(/Server error/)).toBeInTheDocument());
  });
});
