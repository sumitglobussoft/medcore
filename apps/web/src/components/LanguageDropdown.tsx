"use client";

import { useEffect } from "react";
import { useI18nStore, useTranslation, Lang } from "@/lib/i18n";
import { Languages } from "lucide-react";

export function LanguageDropdown({ className }: { className?: string }) {
  const init = useI18nStore((s) => s.init);
  const { lang, setLang } = useTranslation();

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <Languages size={14} className="text-gray-500" aria-hidden="true" />
      <label htmlFor="mc-lang" className="sr-only">
        Language
      </label>
      <select
        id="mc-lang"
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        aria-label="Select language"
        className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
      >
        <option value="en">English</option>
        <option value="hi">हिन्दी</option>
      </select>
    </div>
  );
}
