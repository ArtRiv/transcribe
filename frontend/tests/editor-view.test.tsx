import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/toast";
import { SegmentList } from "@/components/transcribe/editor/segment-list";
import { SpeakerChip } from "@/components/transcribe/editor/speaker-chip";
import { SAMPLE_PAYLOAD } from "@/lib/mock/data";

const wrap = (children: React.ReactNode) => <ToastProvider>{children}</ToastProvider>;

describe("SpeakerChip — D-05 index color cycle", () => {
  it("uses --color-sp-1 for index 0", () => {
    const { container } = render(
      <SpeakerChip speaker={{ id: "S0", label: "Maya" }} speakerIndex={0} />,
    );
    const dot = container.querySelector("span span") as HTMLElement;
    expect(dot.style.background).toContain("--color-sp-1");
  });

  it("cycles back to --color-sp-1 at index 5", () => {
    const { container } = render(
      <SpeakerChip speaker={{ id: "X", label: "Sixth" }} speakerIndex={5} />,
    );
    const dot = container.querySelector("span span") as HTMLElement;
    expect(dot.style.background).toContain("--color-sp-1");
  });

  it("renders aria-label with speaker.label (UI-SPEC §12.4)", () => {
    render(
      <SpeakerChip speaker={{ id: "S0", label: "Maya Okafor" }} speakerIndex={0} />,
    );
    expect(screen.getByRole("img", { name: "Maya Okafor" })).toBeInTheDocument();
  });
});

describe("SegmentList — VIEW-01 + search filter", () => {
  it("renders timestamps + speaker labels for every segment", () => {
    render(
      wrap(
        <SegmentList
          segments={SAMPLE_PAYLOAD.segments}
          speakers={SAMPLE_PAYLOAD.speakers}
          density="normal"
          activeSegId={null}
          searchQuery=""
          dispatch={() => {}}
          onSegmentClick={() => {}}
        />,
      ),
    );
    // VIEW-01: timestamps render in the header row
    expect(
      screen.getAllByText(/^\d{2}:\d{2} → \d{2}:\d{2}$/).length,
    ).toBeGreaterThan(0);
    // VIEW-01: speaker labels render — getAllByRole since speaker appears multiple times
    expect(
      screen.getAllByRole("img", { name: SAMPLE_PAYLOAD.speakers[0]!.label }).length,
    ).toBeGreaterThan(0);
  });

  it("filters by search query case-insensitively", () => {
    const segments = [
      { id: "seg_0001", start: 0, end: 1, speaker: "S0", text: "Hello world" },
      { id: "seg_0002", start: 1, end: 2, speaker: "S0", text: "Goodbye now" },
    ];
    const speakers = [{ id: "S0", label: "Maya" }];
    const { container } = render(
      wrap(
        <SegmentList
          segments={segments}
          speakers={speakers}
          density="normal"
          activeSegId={null}
          searchQuery="HELLO"
          dispatch={() => {}}
          onSegmentClick={() => {}}
        />,
      ),
    );
    // EditableText uses innerHTML for highlights — check textContent (mark splits the text)
    const editables = container.querySelectorAll('[role="textbox"]');
    const texts = Array.from(editables).map((el) => el.textContent ?? "");
    expect(texts.some((t) => t.includes("Hello world"))).toBe(true);
    expect(texts.every((t) => !t.includes("Goodbye"))).toBe(true);
  });

  it('renders "No segments match" empty state', () => {
    render(
      wrap(
        <SegmentList
          segments={SAMPLE_PAYLOAD.segments}
          speakers={SAMPLE_PAYLOAD.speakers}
          density="normal"
          activeSegId={null}
          searchQuery="zzznotfound"
          dispatch={() => {}}
          onSegmentClick={() => {}}
        />,
      ),
    );
    expect(
      screen.getByText(/No segments match "zzznotfound"\./),
    ).toBeInTheDocument();
  });

  it("calls onSegmentClick when a segment is clicked (VIEW-05 click-to-seek)", async () => {
    const user = userEvent.setup();
    const onSegmentClick = vi.fn();
    const segments = SAMPLE_PAYLOAD.segments.slice(0, 2);
    render(
      wrap(
        <SegmentList
          segments={segments}
          speakers={SAMPLE_PAYLOAD.speakers}
          density="normal"
          activeSegId={null}
          searchQuery=""
          dispatch={() => {}}
          onSegmentClick={onSegmentClick}
        />,
      ),
    );
    // Click on the first segment row
    const rows = document.querySelectorAll('[class*="group/segment"]');
    await user.click(rows[0]! as Element);
    expect(onSegmentClick).toHaveBeenCalledWith(segments[0]);
  });
});
