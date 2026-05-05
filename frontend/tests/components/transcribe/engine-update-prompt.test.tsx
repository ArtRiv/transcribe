/**
 * engine-update-prompt.test.tsx
 *
 * Tests for EngineUpdatePrompt component (08-08 Task 1, VERSION-02/03).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { EngineUpdatePrompt } from "@/components/transcribe/engine-update-prompt";

// Mock the version compare module
vi.mock("@/lib/version/compare", () => ({
  isEngineCurrent: vi.fn(),
}));

import { isEngineCurrent } from "@/lib/version/compare";
const mockIsEngineCurrent = isEngineCurrent as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockIsEngineCurrent.mockReset();
});

describe("EngineUpdatePrompt", () => {
  it("renders the update panel when isEngineCurrent returns false", () => {
    mockIsEngineCurrent.mockReturnValue(false);
    render(<EngineUpdatePrompt engineVersion="0.1.0" minVersion="0.2.0" />);
    expect(screen.getByText(/Engine update available/)).toBeInTheDocument();
    expect(screen.getByText(/0\.1\.0/)).toBeInTheDocument();
    expect(screen.getByText(/0\.2\.0/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download latest/ })).toBeInTheDocument();
  });

  it("does not render anything when isEngineCurrent returns true", () => {
    mockIsEngineCurrent.mockReturnValue(true);
    const { container } = render(
      <EngineUpdatePrompt engineVersion="0.2.0" minVersion="0.2.0" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("link points to the GitHub releases page", () => {
    mockIsEngineCurrent.mockReturnValue(false);
    render(<EngineUpdatePrompt engineVersion="0.1.0" minVersion="0.2.0" />);
    const link = screen.getByRole("link", { name: /Download latest/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/artriv/transcribe-engine/releases/latest"
    );
  });
});
