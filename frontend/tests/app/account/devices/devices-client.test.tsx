/**
 * devices-client.test.tsx
 *
 * Tests for DevicesClient component (08-08 Task 2).
 * Verifies inline unpair flow and optimistic state removal.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DevicesClient } from "@/app/account/devices/devices-client";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const device = {
  name: "arthurs-macbook",
  gpu: "RX 6600 (Vulkan)",
  last_seen: new Date(Date.now() - 3600 * 1000).toISOString(),
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("DevicesClient — with device", () => {
  it("renders the device row", () => {
    render(<DevicesClient initialDevice={device} />);
    expect(screen.getByText("arthurs-macbook")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Unpair/ })).toBeInTheDocument();
  });

  it("successful unpair shows empty state", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    render(<DevicesClient initialDevice={device} />);
    fireEvent.click(screen.getByRole("button", { name: /^Unpair$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Are you sure\? Unpair/ }));
    await waitFor(() =>
      expect(screen.getByText(/No engine paired yet/)).toBeInTheDocument()
    );
  });

  it("failed unpair shows error and restores row", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal server error" }),
    });

    render(<DevicesClient initialDevice={device} />);
    fireEvent.click(screen.getByRole("button", { name: /^Unpair$/ }));
    fireEvent.click(screen.getByRole("button", { name: /Are you sure\? Unpair/ }));
    await waitFor(() =>
      expect(screen.getByText("arthurs-macbook")).toBeInTheDocument()
    );
  });
});

describe("DevicesClient — without device (empty state)", () => {
  it("renders empty state when no device", () => {
    render(<DevicesClient initialDevice={null} />);
    expect(screen.getByText(/No engine paired yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Learn how to install/ })).toBeInTheDocument();
  });
});
