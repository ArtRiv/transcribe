"use client";
// Top-right user-identity affordance (Plan 04-05).
// Anonymous/null: "Sign in" button opens sign-in popover.
// Signed-in (non-anon): initials chip + name + chevron opens dropdown menu.
// [Cited: 04-PATTERNS.md "user-button.tsx" row; 04-UI-SPEC §9.2/§9.3]
import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SignInPopover } from "./sign-in-popover";
import { signOut } from "@/lib/auth/actions";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuPopup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export interface UserLite {
  id: string;
  email: string | null;
  name: string | null;
  is_anonymous: boolean;
}

/** First two characters of the user's display name or email local-part, uppercased. */
function initials(user: UserLite): string {
  if (user.name) return user.name.slice(0, 2).toUpperCase();
  if (user.email) return user.email.slice(0, 2).toUpperCase();
  return "??";
}

/**
 * Returns the CSS variable name for the initials chip background.
 * hash(user.id) mod 4 → --color-sp-2..--color-sp-5
 * (UI-SPEC §4.1 item 16 — keeps --accent (--sp-1) collisions to zero)
 */
function chipColorVar(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (h * 31 + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % 4;
  return `--color-sp-${idx + 2}`;
}

/**
 * UserButton component.
 *
 * @param user - null (never authed) | UserLite with is_anonymous=true | UserLite signed-in
 *
 * Rendering:
 * - null OR is_anonymous=true → "Sign in" button → opens SignInPopover
 * - Signed-in (is_anonymous=false) → initials chip + name + chevron → opens DropdownMenu
 */
export function UserButton({ user }: { user: UserLite | null }) {
  const isSignedIn = user !== null && !user.is_anonymous;

  if (!isSignedIn) {
    return (
      <SignInPopover
        trigger={
          <Button variant="default" size="default">
            Sign in
          </Button>
        }
      />
    );
  }

  // Signed-in variant (UI-SPEC §9.3)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
          <button
            {...props}
            className="flex items-center gap-2 h-[42px] px-2 rounded-[11px] hover:bg-(--color-bg-3) transition-colors duration-150"
          >
            {/* Initials chip */}
            <span
              className="w-8 h-8 rounded-[11px] flex items-center justify-center text-[11px] font-semibold"
              style={{
                background: `var(${chipColorVar(user!.id)})`,
                color: "oklch(0.18 0.008 70)",
              }}
            >
              {initials(user!)}
            </span>
            {/* Display name or email local-part */}
            <span className="text-sm font-medium text-(--color-fg-1)">
              {user!.name ?? user!.email?.split("@")[0]}
            </span>
            {/* Chevron indicator */}
            <span aria-hidden="true" className="text-(--color-fg-3) text-xs">
              ⌄
            </span>
          </button>
        )}
      />
      <DropdownMenuPortal>
        <DropdownMenuPositioner sideOffset={6} align="end" className="z-[300]">
          <DropdownMenuPopup className="min-w-[220px]">
            {/* User info header */}
            <div className="px-2.5 py-2">
              <div className="text-sm font-medium text-(--color-fg-0)">
                {user!.name ?? user!.email}
              </div>
              {user!.email && (
                <div
                  className="text-(--color-fg-3)"
                  style={{ fontSize: "11.5px" }}
                >
                  {user!.email}
                </div>
              )}
            </div>
            <div className="h-px bg-(--color-line) my-1" />
            {/* History link */}
            <DropdownMenuItem
              render={(props: React.HTMLAttributes<HTMLElement>) => (
                <Link href="/history" {...props}>
                  ↗ History
                </Link>
              )}
            />
            {/* Sign out */}
            <DropdownMenuItem onClick={() => void signOut()}>
              ⎋ Sign out
            </DropdownMenuItem>
          </DropdownMenuPopup>
        </DropdownMenuPositioner>
      </DropdownMenuPortal>
    </DropdownMenu>
  );
}
