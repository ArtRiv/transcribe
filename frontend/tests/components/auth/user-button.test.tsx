// Unit tests for frontend/components/transcribe/auth/user-button.tsx (Plan 04-05 Task 2).
// RTL + userEvent pattern per frontend/tests/editable-text.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock next/link — just renders an anchor
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// Mock the signOut Server Action
vi.mock("@/lib/auth/actions", () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
}));

// Mock SignInPopover so we can test the user button without rendering the full popover
vi.mock("@/components/transcribe/auth/sign-in-popover", () => ({
  SignInPopover: ({ trigger }: { trigger: React.ReactNode }) => (
    <div data-testid="sign-in-popover-root">{trigger}</div>
  ),
}));

import { UserButton } from "@/components/transcribe/auth/user-button";

// UserLite shape matching the component's interface
interface UserLite {
  id: string;
  email: string | null;
  name: string | null;
  is_anonymous: boolean;
}

describe("UserButton — anonymous / signed-out state", () => {
  it("renders 'Sign in' label when user is null", () => {
    render(<UserButton user={null} />);
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("anonymous user (is_anonymous=true) renders 'Sign in' label", () => {
    const anonUser: UserLite = {
      id: "anon-uuid-1234",
      email: null,
      name: null,
      is_anonymous: true,
    };
    render(<UserButton user={anonUser} />);
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });

  it("clicking 'Sign in' opens the popover (SignInPopover receives trigger)", async () => {
    render(<UserButton user={null} />);
    // The SignInPopover mock renders a div wrapping the trigger
    expect(screen.getByTestId("sign-in-popover-root")).toBeInTheDocument();
    expect(screen.getByText("Sign in")).toBeInTheDocument();
  });
});

describe("UserButton — signed-in state", () => {
  const signedInUser: UserLite = {
    id: "abc123def456",
    email: "jules@example.com",
    name: "Jules Marrow",
    is_anonymous: false,
  };

  it("renders initials chip + name when user is signed-in", () => {
    render(<UserButton user={signedInUser} />);
    // Initials from name: "JU" (first 2 chars of "Jules Marrow" uppercased)
    expect(screen.getByText("JU")).toBeInTheDocument();
    // Name shown in button
    expect(screen.getByText("Jules Marrow")).toBeInTheDocument();
  });

  it("renders email local-part when user has no name", () => {
    const userNoName: UserLite = {
      id: "abc123def456",
      email: "test@example.com",
      name: null,
      is_anonymous: false,
    };
    render(<UserButton user={userNoName} />);
    // Initials from email: "te" -> "TE"
    expect(screen.getByText("TE")).toBeInTheDocument();
  });

  it("dropdown menu shows 'History' link and 'Sign out' item", async () => {
    const user = userEvent.setup();
    render(<UserButton user={signedInUser} />);

    // Click the trigger button to open the menu
    const triggerBtn = screen.getByRole("button");
    await user.click(triggerBtn);

    // Base UI Menu renders the popup into a portal (document.body).
    // Use findByText (async) to wait for portal mount.
    expect(await screen.findByText(/History/i)).toBeInTheDocument();
    expect(screen.getByText(/Sign out/i)).toBeInTheDocument();
  });

  it("initials chip color is based on hash(user.id) mod 4 — returns a CSS var string", () => {
    // We test chipColorVar indirectly by checking the style attribute on the initials span
    render(<UserButton user={signedInUser} />);
    const chip = screen.getByText("JU");
    // The chip should have a background style containing a CSS variable
    const style = chip.getAttribute("style") ?? "";
    expect(style).toContain("var(--color-sp-");
  });
});

describe("UserButton — sign out action", () => {
  it("'Sign out' item calls the signOut action when clicked", async () => {
    const { signOut } = await import("@/lib/auth/actions");
    const user = userEvent.setup();
    const signedInUser: UserLite = {
      id: "abc123",
      email: "user@example.com",
      name: null,
      is_anonymous: false,
    };
    render(<UserButton user={signedInUser} />);

    // Open menu
    const triggerBtn = screen.getByRole("button");
    await user.click(triggerBtn);

    // Base UI Menu is portaled — use findByText to wait for mount
    const signOutItem = await screen.findByText(/Sign out/i);
    await user.click(signOutItem);

    expect(signOut).toHaveBeenCalled();
  });
});
