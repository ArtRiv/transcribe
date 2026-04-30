// frontend/tests/ui-primitives-t2.test.tsx
// Task 2 TDD RED: tests for Switch, Segmented, Range custom primitives

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import * as React from "react";

// --- Switch ---
describe("Switch primitive (D-09 custom)", () => {
  it("renders with role=switch", async () => {
    const { Switch } = await import("@/components/ui/switch");
    render(<Switch checked={false} onCheckedChange={() => {}} aria-label="Toggle" />);
    const sw = screen.getByRole("switch");
    expect(sw).toBeTruthy();
  });

  it("aria-checked reflects checked prop", async () => {
    const { Switch } = await import("@/components/ui/switch");
    const { rerender } = render(
      <Switch checked={false} onCheckedChange={() => {}} aria-label="Toggle" />,
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
    rerender(<Switch checked={true} onCheckedChange={() => {}} aria-label="Toggle" />);
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("data-on reflects checked state", async () => {
    const { Switch } = await import("@/components/ui/switch");
    const { container } = render(
      <Switch checked={true} onCheckedChange={() => {}} aria-label="Toggle" />,
    );
    const el = container.querySelector('[data-slot="switch"]');
    expect(el?.getAttribute("data-on")).toBe("true");
  });

  it("calls onCheckedChange on click", async () => {
    const { Switch } = await import("@/components/ui/switch");
    const handler = vi.fn();
    render(<Switch checked={false} onCheckedChange={handler} aria-label="Toggle" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(handler).toHaveBeenCalledWith(true);
  });

  it("calls onCheckedChange on Space key", async () => {
    const { Switch } = await import("@/components/ui/switch");
    const handler = vi.fn();
    render(<Switch checked={false} onCheckedChange={handler} aria-label="Toggle" />);
    fireEvent.keyDown(screen.getByRole("switch"), { key: " " });
    expect(handler).toHaveBeenCalledWith(true);
  });

  it("does NOT call onCheckedChange when disabled", async () => {
    const { Switch } = await import("@/components/ui/switch");
    const handler = vi.fn();
    render(
      <Switch checked={false} onCheckedChange={handler} aria-label="Toggle" disabled />,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(handler).not.toHaveBeenCalled();
  });

  it("has no hex literals in class output", async () => {
    const { Switch } = await import("@/components/ui/switch");
    const { container } = render(
      <Switch checked={false} onCheckedChange={() => {}} aria-label="t" />,
    );
    const cls = container.querySelector('[data-slot="switch"]')?.getAttribute("class") ?? "";
    expect(cls).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

// --- Segmented ---
describe("Segmented primitive (D-09 custom)", () => {
  const options = [
    { value: "fast", label: "Fast" },
    { value: "average", label: "Average" },
    { value: "slow", label: "Slow" },
  ];

  it("renders with role=radiogroup", async () => {
    const { Segmented } = await import("@/components/ui/segmented");
    const { container } = render(
      <Segmented options={options} value="fast" onValueChange={() => {}} />,
    );
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
  });

  it("each option has role=radio", async () => {
    const { Segmented } = await import("@/components/ui/segmented");
    render(<Segmented options={options} value="fast" onValueChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(3);
  });

  it("selected option has aria-checked=true", async () => {
    const { Segmented } = await import("@/components/ui/segmented");
    render(<Segmented options={options} value="average" onValueChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    const avgRadio = radios.find((r) => r.getAttribute("aria-label") === "Average");
    expect(avgRadio?.getAttribute("aria-checked")).toBe("true");
    const fastRadio = radios.find((r) => r.getAttribute("aria-label") === "Fast");
    expect(fastRadio?.getAttribute("aria-checked")).toBe("false");
  });

  it("calls onValueChange when option is clicked", async () => {
    const { Segmented } = await import("@/components/ui/segmented");
    const handler = vi.fn();
    render(<Segmented options={options} value="fast" onValueChange={handler} />);
    fireEvent.click(screen.getByRole("radio", { name: "Slow" }));
    expect(handler).toHaveBeenCalledWith("slow");
  });

  it("ArrowRight key cycles to next option", async () => {
    const { Segmented } = await import("@/components/ui/segmented");
    const handler = vi.fn();
    const { container } = render(
      <Segmented options={options} value="fast" onValueChange={handler} />,
    );
    const group = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(handler).toHaveBeenCalledWith("average");
  });

  it("ArrowLeft key cycles to prev option (wraps)", async () => {
    const { Segmented } = await import("@/components/ui/segmented");
    const handler = vi.fn();
    const { container } = render(
      <Segmented options={options} value="fast" onValueChange={handler} />,
    );
    const group = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(handler).toHaveBeenCalledWith("slow"); // wraps from first to last
  });
});

// --- Range ---
describe("Range primitive", () => {
  it("renders as input[type=range]", async () => {
    const { Range } = await import("@/components/ui/range");
    const { container } = render(<Range min={0} max={10} value={5} onChange={() => {}} />);
    const el = container.querySelector('[data-slot="range"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute("type")).toBe("range");
  });

  it("passes valueText as aria-valuetext", async () => {
    const { Range } = await import("@/components/ui/range");
    const { container } = render(
      <Range min={0} max={10} value={0} valueText="Auto" onChange={() => {}} />,
    );
    const el = container.querySelector('[data-slot="range"]');
    expect(el?.getAttribute("aria-valuetext")).toBe("Auto");
  });

  it("passes min/max/value through to native input", async () => {
    const { Range } = await import("@/components/ui/range");
    const { container } = render(
      <Range min={1} max={20} value={7} step={1} onChange={() => {}} />,
    );
    const el = container.querySelector("input[type=range]") as HTMLInputElement;
    expect(el.min).toBe("1");
    expect(el.max).toBe("20");
  });
});
