import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditableText } from "@/components/transcribe/editor/editable-text";
import { escapeHtml } from "@/lib/utils/escape-html";

describe("escapeHtml", () => {
  it("escapes the 5 HTML special characters", () => {
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });
  it("escapes a malicious payload", () => {
    const out = escapeHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});

describe("EditableText cursor preservation (Pitfall 5)", () => {
  it("does NOT overwrite textContent when the element is focused", () => {
    const { rerender } = render(
      <EditableText text="hello" onChange={() => {}} />,
    );
    const el = screen.getByRole("textbox") as HTMLDivElement;
    // Simulate focus → user typed (we set textContent directly to mimic typing)
    el.focus();
    el.textContent = "hello world";
    // Parent re-renders with the SAME text prop — without the activeElement
    // guard, the effect would overwrite "hello world" back to "hello".
    rerender(<EditableText text="hello" onChange={() => {}} />);
    expect(el.textContent).toBe("hello world");
  });

  it("DOES update textContent when external text differs and element is NOT focused", () => {
    const { rerender } = render(
      <EditableText text="hello" onChange={() => {}} />,
    );
    const el = screen.getByRole("textbox") as HTMLDivElement;
    // Element not focused — parent updates text → effect should rewrite.
    rerender(<EditableText text="goodbye" onChange={() => {}} />);
    // The effect runs after commit; React's testing-library waits implicitly.
    expect(el.textContent).toBe("goodbye");
  });
});

describe("EditableText XSS safety (RESEARCH §Security Domain)", () => {
  it("does NOT execute HTML in segment text when highlighted", () => {
    const malicious = '<img src=x onerror="window.__pwned = true">';
    const onChange = vi.fn();
    render(<EditableText text={malicious} onChange={onChange} highlight="img" />);
    const el = screen.getByRole("textbox") as HTMLDivElement;
    // The innerHTML must NOT contain an actual <img> element — XSS is closed.
    expect(el.querySelector("img")).toBeNull();
    // The escaped entity for '<' must appear somewhere in innerHTML.
    expect(el.innerHTML).toContain("&lt;");
    // window.__pwned was never set.
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("highlight wraps escaped query matches in <mark>", () => {
    render(<EditableText text="this is a test" onChange={() => {}} highlight="test" />);
    const el = screen.getByRole("textbox") as HTMLDivElement;
    expect(el.querySelector("mark")).toBeTruthy();
    expect(el.querySelector("mark")?.textContent).toBe("test");
  });
});

describe("EditableText events", () => {
  it("calls onChange with edited text on blur", () => {
    const onChange = vi.fn();
    render(<EditableText text="hello" onChange={onChange} />);
    const el = screen.getByRole("textbox") as HTMLDivElement;
    el.textContent = "hello world";
    fireEvent.blur(el);
    expect(onChange).toHaveBeenCalledWith("hello world");
  });

  it("Escape blurs the field (UI-SPEC §10.9)", async () => {
    const user = userEvent.setup();
    render(<EditableText text="hello" onChange={() => {}} />);
    const el = screen.getByRole("textbox") as HTMLDivElement;
    el.focus();
    await user.keyboard("{Escape}");
    expect(document.activeElement).not.toBe(el);
  });
});
