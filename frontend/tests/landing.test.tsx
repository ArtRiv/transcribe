import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingHero } from "@/components/transcribe/landing-hero";

describe("LandingHero (CORE-01)", () => {
  it("renders the status pill with current Phase 02 versions", () => {
    render(<LandingHero />);
    expect(
      screen.getByText(/Home GPU online · pyannote 3\.4 · whisper\.cpp v1\.8/),
    ).toBeInTheDocument();
  });

  it("renders the hero copy verbatim from spec", () => {
    render(<LandingHero />);
    expect(screen.getByText(/Long audio in\./)).toBeInTheDocument();
    expect(screen.getByText("Editable")).toBeInTheDocument();
    expect(screen.getByText("speaker-labeled")).toBeInTheDocument();
  });

  it("renders the sub-copy verbatim from spec", () => {
    render(<LandingHero />);
    expect(
      screen.getByText(/Drop a meeting recording, an interview, a podcast/),
    ).toBeInTheDocument();
  });
});
