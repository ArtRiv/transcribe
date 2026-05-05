/**
 * pair-client.test.tsx
 *
 * Tests for PairClient component (08-08 Task 2).
 * Verifies the useReducer state machine driving the 5 UI states + confirm flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PairClient } from "@/app/pair/pair-client";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const defaultFingerprint = {
  device: "host01",
  gpu: "RX 6600 (Vulkan)",
  engine: "v0.2.0",
  ed25519: "0123456789abcdef…",
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("PairClient — initial state (default)", () => {
  it("renders pair button in idle state", () => {
    render(
      <PairClient
        code="K7H2-Q9X3"
        fingerprint={defaultFingerprint}
        initialKind="default"
      />
    );
    expect(screen.getByRole("button", { name: /Pair this engine/ })).toBeInTheDocument();
  });

  it("B-02: renders real GPU and engine version values (no em-dash fallback)", () => {
    render(
      <PairClient
        code="K7H2-Q9X3"
        fingerprint={defaultFingerprint}
        initialKind="default"
      />
    );
    expect(screen.getByText("RX 6600 (Vulkan)")).toBeInTheDocument();
    expect(screen.getByText("v0.2.0")).toBeInTheDocument();
  });
});

describe("PairClient — confirm flow", () => {
  it("clicking Pair shows loading state then transitions to success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });

    render(
      <PairClient
        code="K7H2-Q9X3"
        fingerprint={defaultFingerprint}
        initialKind="default"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Pair this engine/ }));
    // Loading state
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Pairing/ })).toBeInTheDocument()
    );
    // Success state
    await waitFor(() =>
      expect(screen.getByText(/You're all set/)).toBeInTheDocument()
    );
  });

  it("network error transitions to network failure state", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    render(
      <PairClient
        code="K7H2-Q9X3"
        fingerprint={defaultFingerprint}
        initialKind="default"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Pair this engine/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Can't reach the server/ })).toBeInTheDocument()
    );
  });

  it("410 response transitions to expired failure state", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({ error: "expired_or_unknown" }),
    });

    render(
      <PairClient
        code="K7H2-Q9X3"
        fingerprint={defaultFingerprint}
        initialKind="default"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Pair this engine/ }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Pairing code expired/ })).toBeInTheDocument()
    );
  });

  it("409 device_conflict transitions to conflict state", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        error: "device_conflict",
        existing: {
          name: "old-host",
          gpu: "RX 5700 XT",
          last_seen: new Date().toISOString(),
        },
      }),
    });

    render(
      <PairClient
        code="K7H2-Q9X3"
        fingerprint={defaultFingerprint}
        initialKind="default"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Pair this engine/ }));
    await waitFor(() =>
      expect(screen.getByText(/You already have an engine paired/)).toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: /Replace this engine/ })).toBeInTheDocument();
  });
});

describe("PairClient — initial conflict state", () => {
  it("renders conflict card when initialKind is conflict", () => {
    render(
      <PairClient
        code="K7H2-Q9X3"
        fingerprint={defaultFingerprint}
        initialKind="conflict"
        existingDevice={{
          name: "old-host",
          gpu: "RX 5700 XT",
          last_seen: new Date().toISOString(),
        }}
      />
    );
    expect(
      screen.getByText(/You already have an engine paired/)
    ).toBeInTheDocument();
  });
});

describe("PairClient — initial signed-out state", () => {
  it("renders sign-in panel when initialKind is signed-out", () => {
    render(
      <PairClient
        code="K7H2-Q9X3"
        fingerprint={defaultFingerprint}
        initialKind="signed-out"
      />
    );
    expect(screen.getByText(/Sign in with email/)).toBeInTheDocument();
  });
});
