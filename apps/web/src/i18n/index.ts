import { en } from "./en";
import { fr, type Dict } from "./fr";

export type Locale = "fr" | "en";
export type { Dict };

export const LOCALE_COOKIE = "jotna_lang";
export const dictionaries: Record<Locale, Dict> = { fr, en };
export const isLocale = (v: unknown): v is Locale => v === "fr" || v === "en";
