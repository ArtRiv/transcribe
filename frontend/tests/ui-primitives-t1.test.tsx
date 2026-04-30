// frontend/tests/ui-primitives-t1.test.tsx
// Task 1 TDD RED: tests for Button rewrite + Card, Input, Select, Kbd, Chip primitives
// These tests verify: design variant API, token classes, acceptance criteria checks.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import * as React from "react";

// --- Button ---
describe("Button primitive", () => {
  it("renders with primary variant containing design token class", async () => {
    const { Button } = await import("@/components/ui/button");
    const { container } = render(<Button variant="primary">Click me</Button>);
    const btn = container.querySelector('[data-slot="button"]');
    expect(btn).not.toBeNull();
    const cls = btn!.getAttribute("class") ?? "";
    // Must contain accent color (primary variant)
    expect(cls).toContain("--color-accent");
  });

  it("renders with default variant containing bg-3 token", async () => {
    const { Button } = await import("@/components/ui/button");
    const { container } = render(<Button variant="default">Default</Button>);
    const btn = container.querySelector('[data-slot="button"]');
    const cls = btn!.getAttribute("class") ?? "";
    expect(cls).toContain("--color-bg-3");
  });

  it("renders with ghost variant (no bg, transparent)", async () => {
    const { Button } = await import("@/components/ui/button");
    const { container } = render(<Button variant="ghost">Ghost</Button>);
    const btn = container.querySelector('[data-slot="button"]');
    const cls = btn!.getAttribute("class") ?? "";
    expect(cls).toContain("bg-transparent");
  });

  it("sm size produces h-[26px] class", async () => {
    const { Button } = await import("@/components/ui/button");
    const { container } = render(<Button size="sm">Small</Button>);
    const btn = container.querySelector('[data-slot="button"]');
    const cls = btn!.getAttribute("class") ?? "";
    expect(cls).toContain("h-[26px]");
  });

  it("icon size produces size-8 class", async () => {
    const { Button } = await import("@/components/ui/button");
    const { container } = render(<Button size="icon">X</Button>);
    const btn = container.querySelector('[data-slot="button"]');
    const cls = btn!.getAttribute("class") ?? "";
    expect(cls).toContain("size-8");
  });

  it("does NOT contain shadcn bg-primary class", async () => {
    const { Button } = await import("@/components/ui/button");
    const { container } = render(<Button>Default</Button>);
    const btn = container.querySelector('[data-slot="button"]');
    const cls = btn!.getAttribute("class") ?? "";
    expect(cls).not.toContain("bg-primary");
  });

  it("does NOT contain destructive variant", async () => {
    const { buttonVariants } = await import("@/components/ui/button");
    // buttonVariants should not have a destructive variant
    const defaultCls = buttonVariants({ variant: "default" });
    expect(defaultCls).not.toContain("destructive");
  });
});

// --- Card ---
describe("Card primitive", () => {
  it("renders with bg-2 design token", async () => {
    const { Card } = await import("@/components/ui/card");
    const { container } = render(<Card>content</Card>);
    const el = container.querySelector('[data-slot="card"]');
    expect(el).not.toBeNull();
    const cls = el!.getAttribute("class") ?? "";
    expect(cls).toContain("--color-bg-2");
  });

  it("has border using color-line token", async () => {
    const { Card } = await import("@/components/ui/card");
    const { container } = render(<Card>content</Card>);
    const el = container.querySelector('[data-slot="card"]');
    const cls = el!.getAttribute("class") ?? "";
    expect(cls).toContain("--color-line");
  });
});

// --- Input ---
describe("Input primitive", () => {
  it("renders with h-[34px] class", async () => {
    const { Input } = await import("@/components/ui/input");
    const { container } = render(<Input placeholder="test" />);
    const el = container.querySelector('[data-slot="input"]');
    expect(el).not.toBeNull();
    const cls = el!.getAttribute("class") ?? "";
    expect(cls).toContain("h-[34px]");
  });

  it("renders with bg-2 token class", async () => {
    const { Input } = await import("@/components/ui/input");
    const { container } = render(<Input />);
    const el = container.querySelector('[data-slot="input"]');
    const cls = el!.getAttribute("class") ?? "";
    expect(cls).toContain("--color-bg-2");
  });

  it("passes through standard input props", async () => {
    const { Input } = await import("@/components/ui/input");
    render(<Input data-testid="my-input" type="text" />);
    expect(screen.getByTestId("my-input")).toBeTruthy();
  });
});

// --- Select ---
describe("Select primitive", () => {
  it("renders select with appearance-none", async () => {
    const { Select } = await import("@/components/ui/select");
    const { container } = render(
      <Select>
        <option value="a">A</option>
      </Select>,
    );
    const el = container.querySelector('[data-slot="select"]');
    expect(el).not.toBeNull();
    const cls = el!.getAttribute("class") ?? "";
    expect(cls).toContain("appearance-none");
  });

  it("renders ChevronDown icon wrapper", async () => {
    const { Select } = await import("@/components/ui/select");
    const { container } = render(
      <Select>
        <option value="a">A</option>
      </Select>,
    );
    // ChevronDown is an SVG rendered inside the wrapper div
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });
});

// --- Kbd ---
describe("Kbd primitive", () => {
  it("renders as kbd element with font-mono", async () => {
    const { Kbd } = await import("@/components/ui/kbd");
    const { container } = render(<Kbd>Cmd</Kbd>);
    const el = container.querySelector('[data-slot="kbd"]');
    expect(el).not.toBeNull();
    expect(el!.tagName.toLowerCase()).toBe("kbd");
    const cls = el!.getAttribute("class") ?? "";
    expect(cls).toContain("font-mono");
  });

  it("uses radius-sm token", async () => {
    const { Kbd } = await import("@/components/ui/kbd");
    const { container } = render(<Kbd>F</Kbd>);
    const el = container.querySelector('[data-slot="kbd"]');
    const cls = el!.getAttribute("class") ?? "";
    expect(cls).toContain("--radius-sm");
  });
});

// --- Chip ---
describe("Chip primitive", () => {
  it("renders children text", async () => {
    const { Chip } = await import("@/components/ui/chip");
    render(<Chip>Running</Chip>);
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("renders dot span when dotColor is provided", async () => {
    const { Chip } = await import("@/components/ui/chip");
    const { container } = render(<Chip dotColor="var(--color-ok)">Done</Chip>);
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect((dot as HTMLElement).style.background).toContain("--color-ok");
  });

  it("does NOT render dot span when no dotColor", async () => {
    const { Chip } = await import("@/components/ui/chip");
    const { container } = render(<Chip>Pill</Chip>);
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot).toBeNull();
  });
});
