"use client";

import { useEffect } from "react";
import { useThemeStore } from "@/lib/theme";
import { useI18nStore } from "@/lib/i18n";

/**
 * Runs once on mount to sync the theme and i18n stores with localStorage.
 * Rendered near the top of the root layout so the rest of the tree sees the
 * correct values immediately after hydration.
 */
export function ThemeBootstrap() {
  const initTheme = useThemeStore((s) => s.init);
  const initLang = useI18nStore((s) => s.init);

  useEffect(() => {
    initTheme();
    initLang();
  }, [initTheme, initLang]);

  return null;
}
