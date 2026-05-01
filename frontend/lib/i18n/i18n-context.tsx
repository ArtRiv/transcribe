"use client";
//
// Hand-rolled i18n provider.
//
// Why hand-rolled (no next-intl / i18next / react-intl): see plan §next16_caveat.
// Single-route app, 2 locales, ~100 strings, no pluralization beyond 1-vs-N.
// A 60-line context is leaner than any library wrapper and removes a build
// dependency on a Server Component-aware i18n library.
//
// Initial-locale resolution order (first match wins):
//   1. localStorage["transcribe.locale"] — the user's previous explicit choice
//   2. navigator.language — browser preference (anything starting with "pt"
//      maps to pt-BR, since pt-PT translations are not maintained)
//   3. "en" fallback
//
// SSR returns "en" deterministically; the provider corrects on mount in a
// useEffect. <html lang> is also synced for screen readers / Lighthouse a11y.

import * as React from "react";
import { EN_MESSAGES } from "./messages-en";
import { PT_BR_MESSAGES } from "./messages-pt-BR";
import type { Locale, Messages } from "./types";

const CATALOGS: Record<Locale, Messages> = {
  en: EN_MESSAGES,
  "pt-BR": PT_BR_MESSAGES,
};

const STORAGE_KEY = "transcribe.locale";

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "pt-BR") return stored;
  } catch {
    // Safari private mode / quota exceeded — fall through.
  }
  const nav =
    typeof navigator !== "undefined" && navigator.language
      ? navigator.language
      : "en";
  if (nav.toLowerCase().startsWith("pt")) return "pt-BR";
  return "en";
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Messages;
}

const Ctx = React.createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Lazy initial state: SSR sees "en" deterministically; the post-hydration
  // useEffect below corrects to the detected/stored locale.
  const [locale, setLocaleState] = React.useState<Locale>("en");

  // On mount, sync to the actual stored / browser-detected locale.
  React.useEffect(() => {
    const initial = detectInitialLocale();
    if (initial !== locale) setLocaleState(initial);
    // We intentionally run this only once on mount (parity with the localStorage
    // read in detectInitialLocale). Subsequent updates flow through setLocale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep <html lang> in sync so screen readers + Lighthouse pick up the locale.
  React.useEffect(() => {
    try {
      document.documentElement.lang = locale === "pt-BR" ? "pt-BR" : "en";
    } catch {
      /* SSR / hostile environments — swallow */
    }
  }, [locale]);

  const setLocale = React.useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* private mode — UX still updates this session, just no persistence */
    }
  }, []);

  const value = React.useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: CATALOGS[locale] }),
    [locale, setLocale],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Hook for consumers. Falls back to the English catalog if rendered outside
 *  a provider — production always has a provider (root layout wires it), but
 *  isolated tests don't bother to mount one. The fallback also keeps the type
 *  contract honest: components can `const { t } = useI18n()` unconditionally
 *  without null-checks scattered everywhere.
 *
 *  setLocale is a no-op outside a provider, which is the correct behavior:
 *  there's nowhere to hoist the locale state to. */
const NOOP_VALUE: I18nContextValue = {
  locale: "en",
  setLocale: () => {},
  t: EN_MESSAGES,
};
export function useI18n(): I18nContextValue {
  return React.useContext(Ctx) ?? NOOP_VALUE;
}

/** Tiny formatter for "{key}" placeholders. Keeps the catalog types simple
 *  (plain strings) at the cost of a one-line helper at each call site. */
export function format(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}
