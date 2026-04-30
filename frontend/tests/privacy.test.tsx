import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingFooter } from "@/components/transcribe/landing-hero";

describe("LandingFooter / Privacy posture (SEC-09)", () => {
  it("renders the spec-locked privacy posture line", () => {
    render(<LandingFooter />);
    // SEC-09 wording — DO NOT paraphrase
    expect(
      screen.getByText(
        /Public URL works only while my home PC is awake — that's a feature, not a bug\./,
      ),
    ).toBeInTheDocument();
  });
});
