import type { Metadata } from "next";
import Link from "next/link";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { MswInit } from "./(mock-init)/msw-init";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  UserButton,
  type UserLite,
} from "@/components/transcribe/auth/user-button";
import { I18nProvider } from "@/lib/i18n/i18n-context";
import * as Tooltip from "@/components/ui/tooltip";
import { LanguageToggle } from "@/components/transcribe/language-toggle";

// Per D-03 + RESEARCH §Pattern 1: three families, exposed as CSS variables
// consumed by globals.css @theme inline.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  // Fraunces is a variable font — weight must be omitted (or "variable") when axes is set.
  // Weights 400/500 are accessible via font-weight utilities; the full axis range loads.
  style: ["normal", "italic"],
  axes: ["opsz"], // optical sizing — required for the design's hero
  variable: "--font-fraunces",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Transcribe",
  description:
    "Free, self-hostable audio/video transcription with speaker labels.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Fetch the current user server-side for the UserButton (AUTH-03 session persistence).
  // Anti-pattern avoided: uses getUser() (round-trip-verified), NOT getSession().
  // [Cited: 04-PATTERNS.md §"Pitfall 5 — getSession()"; 04-UI-SPEC §9.1 D-04]
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userLite: UserLite | null = user
    ? {
        id: user.id,
        email: user.email ?? null,
        name: (user.user_metadata?.name as string | undefined) ?? null,
        is_anonymous: Boolean(user.is_anonymous),
      }
    : null;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* I18nProvider wraps the entire body so AppBar (LanguageToggle) and
            every page share the same locale state. The provider is a Client
            Component, which is fine inside an async Server Component layout —
            the server renders the "en" default; the client provider corrects
            on hydration via localStorage / navigator.language.

            Tooltip.Provider is hoisted to the layout so the AppBar's
            LanguageToggle tooltip works without each route adding its own
            provider; the editor's nested Tooltip.Provider remains for safety
            but is now a no-op (Base UI tolerates nesting). */}
        <I18nProvider>
          <Tooltip.Provider>
            <AppBar userLite={userLite} />
            <main className="flex-1 relative z-[2]">
              <MswInit>{children}</MswInit>
            </main>
          </Tooltip.Provider>
        </I18nProvider>
      </body>
    </html>
  );
}

/**
 * Top app bar — updated in Phase 4 (Plan 04-05) to reinstate the user button
 * (deferred in Phase 3 per UI-SPEC §9.1) and add D-04 divider.
 *
 * Phase 4 changes from Phase 3:
 *   - ADD <UserButton user={userLite} /> to the RIGHT side of the status pill area
 *   - ADD 1px --line vertical divider (D-04) between status pill and user button
 *   - DROP settings cog (nav-settings) — Phase 5 scope per UI-SPEC §9.1
 *
 * Note: Nav tabs (New | Editor | History) are deferred to plan 04-07 which handles
 * the History route. The History link is accessible via the user-button dropdown.
 * [Cited: 04-UI-SPEC §9.1; 04-CONTEXT D-04]
 */
function AppBar({ userLite }: { userLite: UserLite | null }) {
  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between px-4 border-b border-(--color-line)"
      style={{
        height: 64,
        background: "oklch(0.20 0.008 70 / 0.7)", // Transcribe.html lines 173-174
        backdropFilter: "blur(12px)",
      }}
    >
      {/* Left: brand mark + name + version badge — Transcribe.html lines 212-228.
          Wrapped in a Link to /, so clicking the wordmark returns to the landing page. */}
      <Link
        href="/"
        aria-label="Go to home"
        className="flex items-center gap-2 no-underline"
        style={{ color: "inherit", textDecoration: "none" }}
      >
        {/* Brand mark — 22×22 accent square, italic Fraunces T */}
        <span
          aria-hidden="true"
          style={{
            width: 22,
            height: 22,
            display: "inline-grid",
            placeItems: "center",
            background: "var(--color-accent)",
            color: "oklch(0.18 0.020 70)",
            borderRadius: "var(--radius-sm)",
            fontFamily: "var(--font-serif)",
            fontSize: 17,
            fontStyle: "italic",
            lineHeight: 1,
            paddingBottom: 2, // optical baseline correction
          }}
        >
          T
        </span>
        <span
          className="text-(--color-fg-0) font-semibold text-sm"
          style={{ letterSpacing: "-0.01em" }}
        >
          Transcribe
        </span>
        {/* Version badge — Transcribe.html lines 180-189.
            Padding tweaked from "1px 6px" → "2px 6px 1px" so the cap-height of
            the wordmark and the small-caps badge text share the same optical
            baseline (item line 9 of Things-to-change.txt). */}
        <span
          className="text-(--color-fg-4)"
          style={{
            display: "inline-flex",
            alignItems: "center",
            marginLeft: 4,
            fontSize: "10.5px",
            padding: "2px 6px 1px",
            border: "1px solid var(--color-line)",
            borderRadius: 4,
            whiteSpace: "nowrap",
            lineHeight: 1.4,
          }}
        >
          v0.4 · self-hosted
        </span>
      </Link>

      {/* Right: status pill + D-04 divider + user button */}
      <div className="flex items-center gap-2">
        {/* Status pill — UI-SPEC §13.5 (Phase 5 wires real /healthz) */}
        <div
          className="inline-flex items-center gap-1.5"
          role="status"
          aria-live="polite"
        >
          {/* Live dot — Transcribe.html lines 251-256 */}
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--color-ok)",
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
          <span
            className="mono text-(--color-fg-3)"
            style={{ fontSize: "11.5px" }}
          >
            home-gpu-01
          </span>
          <span className="text-(--color-fg-4)" style={{ fontSize: "11.5px" }}>
            ·
          </span>
          <span className="text-(--color-fg-3)" style={{ fontSize: "11.5px" }}>
            idle
          </span>
        </div>

        {/* D-04: 1px --line vertical divider between status pill and user button */}
        <div
          aria-hidden="true"
          style={{
            width: 1,
            height: 16,
            background: "var(--color-line)",
          }}
        />

        {/* Language toggle (quick task 260501-1e4 — item line 7).
            Two-locale flag toggle; English ↔ Brazilian Portuguese. */}
        <LanguageToggle />

        {/* User button (Phase 4 — reinstated from deferred list per UI-SPEC §0:32) */}
        {/* Note: settings cog (nav-settings) is DROPPED — Phase 5 scope (UI-SPEC §9.1) */}
        <UserButton user={userLite} />
      </div>
    </header>
  );
}
