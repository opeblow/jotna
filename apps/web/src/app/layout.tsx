import type { Metadata, Viewport } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { I18nProvider } from "@/components/i18n";
import { getLocale } from "@/lib/locale";
import "./globals.css";

// Two variable font files, Latin subset only, swapped in after first paint.
const fraunces = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Jotna — Payé à la porte", template: "%s · Jotna" },
  description:
    "Paiement à la livraison sans cash. Le client bloque le paiement avant le départ du livreur, un scan à la porte le libère.",
  applicationName: "Jotna",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#f6f7f3", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} data-scroll-behavior="smooth" className={`${fraunces.variable} ${instrument.variable}`}>
      <body className="min-h-dvh bg-paper text-ink antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
