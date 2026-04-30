import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UploadZone } from "@/components/transcribe/upload-zone";

describe("UploadZone — empty state (CORE-02)", () => {
  it("renders Drop / browse copy", () => {
    render(<UploadZone file={null} onFile={() => {}} onClear={() => {}} />);
    expect(
      screen.getByRole("button", { name: /Drop audio or video/i }),
    ).toBeInTheDocument();
  });

  it("opens file picker on Enter (RESEARCH §Pattern 8 a11y add)", async () => {
    const user = userEvent.setup();
    render(<UploadZone file={null} onFile={() => {}} onClear={() => {}} />);
    const zone = screen.getByRole("button", { name: /Drop audio or video/i });
    zone.focus();
    // Spy on the hidden input's click — file picker dialog can't be tested directly.
    const input = zone.querySelector("input[type='file']") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await user.keyboard("{Enter}");
    expect(click).toHaveBeenCalled();
  });

  it("opens file picker on Space", async () => {
    const user = userEvent.setup();
    render(<UploadZone file={null} onFile={() => {}} onClear={() => {}} />);
    const zone = screen.getByRole("button", { name: /Drop audio or video/i });
    zone.focus();
    const input = zone.querySelector("input[type='file']") as HTMLInputElement;
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    await user.keyboard(" ");
    expect(click).toHaveBeenCalled();
  });

  it("calls onFile when a file is dropped", () => {
    const onFile = vi.fn();
    render(<UploadZone file={null} onFile={onFile} onClear={() => {}} />);
    const zone = screen.getByRole("button", { name: /Drop audio or video/i });
    const file = new File(["audio"], "rec.mp3", { type: "audio/mpeg" });
    // jsdom DataTransfer is incomplete — fake it.
    fireEvent.drop(zone, {
      preventDefault: () => {},
      dataTransfer: { files: [file] },
    });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("renders inline error in --color-err style when validationError is set (D-21 inline)", () => {
    render(
      <UploadZone
        file={null}
        onFile={() => {}}
        onClear={() => {}}
        validationError="Files over 5 GB or 5 hours can't process here."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Files over 5 GB/);
  });
});

describe("UploadZone — file-selected state (CORE-03)", () => {
  it("renders file name, size, and 'estimating…' until duration arrives", () => {
    const file = new File(
      [new Uint8Array(2_500_000)],
      "weekly meeting.m4a",
      { type: "audio/mp4" },
    );
    render(
      <UploadZone file={file} duration={null} onFile={() => {}} onClear={() => {}} />,
    );
    expect(screen.getByText("weekly meeting.m4a")).toBeInTheDocument();
    expect(screen.getByText(/estimating…/)).toBeInTheDocument();
  });

  it("renders duration once it loads", () => {
    const file = new File([new Uint8Array(1024)], "x.mp3", {
      type: "audio/mpeg",
    });
    render(
      <UploadZone
        file={file}
        duration={134.5}
        onFile={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.getByText(/2:14/)).toBeInTheDocument();
  });

  it("calls onClear when Replace is clicked", async () => {
    const onClear = vi.fn();
    const user = userEvent.setup();
    const file = new File([new Uint8Array(1024)], "x.mp3", {
      type: "audio/mpeg",
    });
    render(
      <UploadZone
        file={file}
        duration={null}
        onFile={() => {}}
        onClear={onClear}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Replace file/i }));
    expect(onClear).toHaveBeenCalled();
  });
});
