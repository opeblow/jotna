"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { IconLogout, IconPlus, IconWallet } from "@/components/icons";
import { LanguageSwitch, useI18n } from "@/components/i18n";
import { buttonClass, Logo, Spinner } from "@/components/ui";
import { api, ApiError, type Me } from "@/lib/api";

const MeContext = createContext<{ me: Me; refresh: () => Promise<void> } | null>(null);

export function useMe() {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe must be used inside the seller app");
  return ctx;
}

/** Frame for the seller's pages: loads the session once, redirects to sign-in when there is none. */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("GET", "/me"));
      setFailed(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else setFailed(true);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function logout() {
    await api("POST", "/auth/logout").catch(() => {});
    router.replace("/");
  }

  if (!me) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        {failed ? (
          <>
            <p className="text-lg">{t.common.offline}</p>
            <button onClick={() => void refresh()} className={buttonClass("secondary")}>
              {t.common.retry}
            </button>
          </>
        ) : (
          <Spinner className="size-8 text-ink-soft" />
        )}
      </div>
    );
  }

  const tabs = [
    { href: "/app", label: t.app.nav.orders, active: pathname === "/app" || pathname.startsWith("/app/orders") },
    { href: "/app/wallet", label: t.app.nav.wallet, active: pathname.startsWith("/app/wallet") },
  ];

  return (
    <MeContext.Provider value={{ me, refresh }}>
      <div className="min-h-dvh pb-24 md:pb-10">
        {me.features.network !== "mainnet" && (
          <p className="bg-indigo-deep py-1.5 text-center text-xs font-semibold tracking-wide text-card uppercase">
            {t.common.testNetwork} · {me.features.network}
          </p>
        )}
        <header className="sticky top-0 z-30 border-b border-line bg-card/90 backdrop-blur-xl">
          <div className="wrap flex items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-6">
              <Logo href="/app" />
              <nav className="hidden items-center gap-1 border-l border-line pl-5 md:flex">
                {tabs.map((tab) => (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={tab.active ? "page" : undefined}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${tab.active ? "bg-sky text-indigo-deep" : "text-ink-soft hover:bg-sand hover:text-ink"}`}
                  >
                    {tab.label}
                  </Link>
                ))}
                <Link href={`/s/${me.seller.shop_slug}`} className="rounded-full px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-sand hover:text-ink">
                  {t.app.nav.shop}
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-1">
              <LanguageSwitch className="hidden sm:block" />
              <Link href="/app/new" className={buttonClass("primary", "sm", "hidden md:inline-flex")}>
                <IconPlus width={18} height={18} />
                {t.app.nav.new}
              </Link>
              <button onClick={logout} aria-label={t.app.nav.logout} title={t.app.nav.logout} className="flex size-10 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:bg-sand hover:text-ink">
                <IconLogout width={20} height={20} />
              </button>
            </div>
          </div>
        </header>

        <main className="wrap max-w-[82rem] py-7 md:py-11">{children}</main>

        {/* Thumb-reach navigation on phones. */}
        <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-20px_rgba(24,36,31,0.35)] backdrop-blur-xl md:hidden">
          <div className="mx-auto grid max-w-md grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Link href="/app" aria-current={tabs[0]!.active ? "page" : undefined} className={`rounded-full py-2.5 text-center text-sm font-semibold ${tabs[0]!.active ? "bg-sky text-indigo-deep" : "text-ink-soft"}`}>
              {t.app.nav.orders}
            </Link>
            <Link href="/app/new" aria-label={t.app.nav.new} className="flex size-12 items-center justify-center rounded-full bg-indigo-deep text-card shadow-md transition-transform active:scale-95">
              <IconPlus width={26} height={26} />
            </Link>
            <Link href="/app/wallet" aria-current={tabs[1]!.active ? "page" : undefined} className={`flex items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-semibold ${tabs[1]!.active ? "bg-sky text-indigo-deep" : "text-ink-soft"}`}>
              <IconWallet width={18} height={18} />
              {t.app.nav.wallet}
            </Link>
          </div>
        </nav>
      </div>
    </MeContext.Provider>
  );
}
