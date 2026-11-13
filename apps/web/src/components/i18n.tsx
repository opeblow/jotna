"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { dictionaries, LOCALE_COOKIE, type Dict, type Locale } from "@/i18n";
import { ApiError } from "@/lib/api";

const I18nContext = createContext<{ locale: Locale; t: Dict }>({ locale: "fr", t: dictionaries.fr });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, t: dictionaries[locale] }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

/** Turn any thrown value into a sentence the person can act on, in their language. */
export function useErrorText() {
  const { t } = useI18n();
  return (err: unknown): string => {
    if (err instanceof ApiError) return t.errors[err.code] ?? (err.status >= 500 ? t.errors.internal_error! : err.message);
    return t.errors.internal_error!;
  };
}

export function LanguageSwitch({ className = "" }: { className?: string }) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const next: Locale = locale === "fr" ? "en" : "fr";
  return (
    <button
      type="button"
      lang={next}
      onClick={() => {
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
      className={`rounded-full px-3 py-2 text-sm font-medium text-ink-soft underline-offset-4 hover:text-ink hover:underline ${className}`}
    >
      {t.common.language}
    </button>
  );
}
