import type { Locale } from "@/i18n";

const nbsp = " ";

/** 16 500 F — thin grouping, the way prices are written on Dakar price tags. */
export function xof(amount: number): string {
  return `${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, nbsp)}${nbsp}F`;
}

export function sats(amount: number): string {
  return `${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, nbsp)}${nbsp}sats`;
}

export function shortDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short" }).format(new Date(iso));
}

export function dateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function clock(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** "2 h 05" / "14 min" / "45 s" until a moment, or null once it has passed. */
export function countdown(untilIso: string, now: number): string | null {
  const ms = new Date(untilIso).getTime() - now;
  if (ms <= 0) return null;
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}${nbsp}h${nbsp}${String(m).padStart(2, "0")}`;
  if (m > 0) return `${m}${nbsp}min${nbsp}${String(s).padStart(2, "0")}`;
  return `${s}${nbsp}s`;
}

export function windowLabel(minutes: number): string {
  if (minutes % 60 === 0) return `${minutes / 60}${nbsp}h`;
  if (minutes < 60) return `${minutes}${nbsp}min`;
  return `${Math.floor(minutes / 60)}${nbsp}h${nbsp}${String(minutes % 60).padStart(2, "0")}`;
}
