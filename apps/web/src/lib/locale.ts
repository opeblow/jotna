import { cookies, headers } from "next/headers";
import { dictionaries, isLocale, LOCALE_COOKIE, type Locale } from "@/i18n";

/** Locale for a server render: the visitor's saved choice, else their browser language, else French. */
export async function getLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;
  const accept = (await headers()).get("accept-language") ?? "";
  return /^en\b/i.test(accept.trim()) ? "en" : "fr";
}

export async function getDict() {
  const locale = await getLocale();
  return { locale, t: dictionaries[locale] };
}
