import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "@/components/ui/toast";

function Harness({ onUndo }: { onUndo: () => void }) {
  const { show } = useToast();
  return (
    <button
      onClick={() =>
        show("Deleted Foo", { action: { label: "Undo", onClick: onUndo } })
      }
    >
      trigger
    </button>
  );
}

describe("toast with action (delete-undo)", () => {
  it("renders the action label", async () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Harness onUndo={onUndo} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText("trigger"));
    expect(screen.getByText("Undo")).toBeInTheDocument();
  });

  it("clicking action invokes onClick and dismisses toast", async () => {
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Harness onUndo={onUndo} />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText("trigger"));
    await userEvent.click(screen.getByText("Undo"));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Undo")).not.toBeInTheDocument();
  });

  it("times out after 5000ms by default when action is set", () => {
    vi.useFakeTimers();
    try {
      const onUndo = vi.fn();
      render(
        <ToastProvider>
          <Harness onUndo={onUndo} />
        </ToastProvider>,
      );
      // Use fireEvent.click (sync) to avoid userEvent's own internal timers
      // which can hang under vi.useFakeTimers().
      act(() => {
        fireEvent.click(screen.getByText("trigger"));
      });
      expect(screen.getByText("Undo")).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(5000); });
      expect(screen.queryByText("Undo")).not.toBeInTheDocument();
      expect(onUndo).not.toHaveBeenCalled();   // timeout = commit, not undo
    } finally {
      vi.useRealTimers();
    }
  });
});
