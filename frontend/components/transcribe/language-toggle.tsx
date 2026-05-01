"use client";
//
// Two-locale flag toggle in the AppBar (Task 3 of quick task 260501-1e4).
// Click cycles between en (🇺🇸) and pt-BR (🇧🇷). The plan deliberately keeps
// this as a simple toggle rather than a dropdown — only two locales, and a
// dropdown introduces extra widget weight (Base UI dropdown + ARIA menu).
//
// The flag emoji renders correctly on macOS, iOS, Android, and modern Linux
// distros that ship Twemoji / Noto Color Emoji. On Windows 10 the regional
// indicator chars fall back to "US"/"BR" — acceptable for the developer's
// home-PC self-host scenario.

import * as React from "react";
import * as Tooltip from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n/i18n-context";

export function LanguageToggle() {
  const { locale, setLocale, t } = useI18n();
  const flag = locale === "pt-BR" ? "🇧🇷" : "🇺🇸";
  const next = locale === "pt-BR" ? "en" : "pt-BR";
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <button
            type="button"
            onClick={() => setLocale(next)}
            aria-label={t.language_toggle_aria}
            className="inline-flex items-center justify-center hover:bg-(--color-bg-3) rounded-md transition-colors cursor-pointer"
            style={{
              width: 32,
              height: 32,
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            <span aria-hidden="true">{flag}</span>
          </button>
        }
      />
      <Tooltip.Panel>{t.language_toggle_aria}</Tooltip.Panel>
    </Tooltip.Root>
  );
}
