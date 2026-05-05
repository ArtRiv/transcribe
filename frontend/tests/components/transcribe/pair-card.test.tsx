/**
 * pair-card.test.tsx
 *
 * Tests for PairCard component (08-08 Task 1).
 * Verifies all 5 UI-SPEC states render correct headings, CTAs, and fingerprint values.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PairCard } from "@/components/transcribe/pair-card";
import type { PairState } from "@/components/transcribe/pair-card";

const defaultFingerprint = {
  device: "host01",
  gpu: "RX 6600 (Vulkan)",
  engine: "v0.2.0",
  ed25519: "0123456789abcdef…",
};

describe("PairCard — State 2 (default / signed-in)", () => {
  it("renders heading and pair button", () => {
    const state: PairState = { kind: "default", fingerprint: defaultFingerprint };
    render(<PairCard state={state} onPair={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent(
      "Engine running on your computer"
    );
    expect(screen.getByRole("button", { name: /Pair this engine/ })).toBeInTheDocument();
  });

  it("renders all 4 mono fingerprint values verbatim (B-02)", () => {
    const state: PairState = { kind: "default", fingerprint: defaultFingerprint };
    render(<PairCard state={state} onPair={() => {}} />);
    expect(screen.getByText("host01")).toBeInTheDocument();
    expect(screen.getByText("RX 6600 (Vulkan)")).toBeInTheDocument();
    expect(screen.getByText("v0.2.0")).toBeInTheDocument();
    expect(screen.getByText("0123456789abcdef…")).toBeInTheDocument();
  });

  it("uses dl/dt/dd for fingerprint accessibility", () => {
    const state: PairState = { kind: "default", fingerprint: defaultFingerprint };
    const { container } = render(<PairCard state={state} onPair={() => {}} />);
    expect(container.querySelector("dl")).not.toBeNull();
    expect(container.querySelectorAll("dt").length).toBeGreaterThanOrEqual(4);
    expect(container.querySelectorAll("dd").length).toBeGreaterThanOrEqual(4);
  });
});

describe("PairCard — State 1 (signed-out)", () => {
  it("renders sign-in panel instead of pair button", () => {
    const state: PairState = { kind: "signed-out", fingerprint: defaultFingerprint };
    render(<PairCard state={state} onPair={() => {}} />);
    expect(screen.getByText(/Sign in with email/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pair this engine/ })).toBeNull();
  });

  it("renders fingerprint values including gpu and engine (B-02 — no em-dash fallback)", () => {
    const state: PairState = { kind: "signed-out", fingerprint: defaultFingerprint };
    render(<PairCard state={state} onPair={() => {}} />);
    expect(screen.getByText("RX 6600 (Vulkan)")).toBeInTheDocument();
    expect(screen.getByText("v0.2.0")).toBeInTheDocument();
    // Explicitly assert em-dash is NOT a value in any dd
    const dds = document.querySelectorAll("dd");
    for (const dd of Array.from(dds)) {
      expect(dd.textContent).not.toBe("—");
    }
  });
});

describe("PairCard — State 3 (success)", () => {
  it("renders success heading and two CTAs", () => {
    const state: PairState = { kind: "success" };
    render(<PairCard state={state} onPair={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("You're all set.");
    expect(screen.getByRole("link", { name: /Go to transcribe/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage devices/ })).toBeInTheDocument();
  });
});

describe("PairCard — State 4 (failure variants)", () => {
  it("expired: renders correct heading, no Try again button", () => {
    const state: PairState = {
      kind: "failure",
      reason: "expired",
    };
    render(<PairCard state={state} onPair={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Pairing code expired.");
    expect(
      screen.queryByRole("button", { name: /Try again/ })
    ).toBeNull();
  });

  it("network: renders correct heading and Try again button", () => {
    const state: PairState = { kind: "failure", reason: "network" };
    render(<PairCard state={state} onPair={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Can't reach the server.");
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("engine-offline: renders correct heading and Try again button", () => {
    const state: PairState = { kind: "failure", reason: "engine-offline" };
    render(<PairCard state={state} onPair={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Engine not detected.");
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("generic: renders error heading and Try again button", () => {
    const state: PairState = {
      kind: "failure",
      reason: "generic",
      errorCode: "ERR_500",
    };
    render(<PairCard state={state} onPair={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent("Pairing failed.");
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    expect(screen.getByText("ERR_500")).toBeInTheDocument();
  });
});

describe("PairCard — State 5 (conflict)", () => {
  it("renders conflict heading, existing device info, and Replace/Cancel buttons", () => {
    const state: PairState = {
      kind: "conflict",
      fingerprint: defaultFingerprint,
      existing: {
        name: "old-host",
        gpu: "RX 5700 XT",
        last_seen: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      },
    };
    render(<PairCard state={state} onPair={() => {}} onReplace={() => {}} onCancelConflict={() => {}} />);
    expect(screen.getByRole("heading")).toHaveTextContent(
      "You already have an engine paired."
    );
    expect(screen.getByRole("button", { name: /Replace this engine/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeInTheDocument();
    expect(screen.getByText("old-host")).toBeInTheDocument();
    expect(screen.getByText("RX 5700 XT")).toBeInTheDocument();
  });
});
