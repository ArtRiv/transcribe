import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OptionsPanel } from "@/components/transcribe/options-panel";
import type { JobOptions } from "@/lib/job/submit";

const defaults: JobOptions = {
  preset: "average",
  diarize: true,
  num_speakers: 0,
};

describe("OptionsPanel — quality preset (OPTS-01, OPTS-02)", () => {
  it("renders Fast / Balanced / Best with hints", () => {
    render(<OptionsPanel options={defaults} onChange={() => {}} defaultOpen />);
    expect(screen.getByRole("radio", { name: /Fast/i })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /Balanced/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Best/i })).toBeInTheDocument();
  });

  it("Balanced is the default-selected option (UI-SPEC §13.1)", () => {
    render(<OptionsPanel options={defaults} onChange={() => {}} defaultOpen />);
    expect(screen.getByRole("radio", { name: /Balanced/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("Best is disabled in Phase 3 by default (OPTS-07)", () => {
    render(<OptionsPanel options={defaults} onChange={() => {}} defaultOpen />);
    expect(screen.getByRole("radio", { name: /Best/i })).toBeDisabled();
  });

  it("Best is enabled when bestUnlocked=true (Phase 4 hook)", () => {
    render(
      <OptionsPanel
        options={defaults}
        onChange={() => {}}
        bestUnlocked
        defaultOpen
      />,
    );
    expect(screen.getByRole("radio", { name: /Best/i })).not.toBeDisabled();
  });

  it("emits preset='fast' when Fast is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OptionsPanel options={defaults} onChange={onChange} defaultOpen />);
    await user.click(screen.getByRole("radio", { name: /Fast/i }));
    expect(onChange).toHaveBeenCalledWith({ ...defaults, preset: "fast" });
  });
});

describe("OptionsPanel — language (OPTS-05, OPTS-06)", () => {
  it("includes Auto-detect as the first option", () => {
    render(<OptionsPanel options={defaults} onChange={() => {}} defaultOpen />);
    const select = screen.getByRole("combobox", { name: /Spoken language/i });
    const firstOption = select.querySelector("option");
    expect(firstOption?.value).toBe("");
    expect(firstOption?.textContent).toMatch(/Auto-detect/);
  });

  it("emits language='pt' when Portuguese is selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OptionsPanel options={defaults} onChange={onChange} defaultOpen />);
    const select = screen.getByRole("combobox", { name: /Spoken language/i });
    await user.selectOptions(select, "pt");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ language: "pt" }),
    );
  });
});

describe("OptionsPanel — diarization (OPTS-03)", () => {
  it("toggles diarize via switch", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<OptionsPanel options={defaults} onChange={onChange} defaultOpen />);
    await user.click(
      screen.getByRole("switch", { name: /Enable diarization/i }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ diarize: false }),
    );
  });

  it("disables the speakers row when diarize is off", () => {
    render(
      <OptionsPanel
        options={{ ...defaults, diarize: false }}
        onChange={() => {}}
        defaultOpen
      />,
    );
    const slider = screen.getByRole("slider", { name: /Number of speakers/i });
    expect(slider).toBeDisabled();
  });
});

describe("OptionsPanel — speakers (OPTS-04)", () => {
  it("displays 'Auto' when num_speakers=0", () => {
    render(<OptionsPanel options={defaults} onChange={() => {}} defaultOpen />);
    expect(screen.getByText("Auto")).toBeInTheDocument();
  });

  it("displays '3 speakers' when num_speakers=3", () => {
    render(
      <OptionsPanel
        options={{ ...defaults, num_speakers: 3 }}
        onChange={() => {}}
        defaultOpen
      />,
    );
    expect(screen.getByText(/3 speakers/)).toBeInTheDocument();
  });

  it("displays '1 speaker' (singular) when num_speakers=1", () => {
    render(
      <OptionsPanel
        options={{ ...defaults, num_speakers: 1 }}
        onChange={() => {}}
        defaultOpen
      />,
    );
    expect(screen.getByText(/1 speaker$/)).toBeInTheDocument();
  });
});
