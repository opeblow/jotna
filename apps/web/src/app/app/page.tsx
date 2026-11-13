"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/components/AppShell";
import { IconArrow, IconPlus, IconWallet } from "@/components/icons";
import { useErrorText, useI18n } from "@/components/i18n";
import { Button, buttonClass, Notice, Spinner, StatusBadge } from "@/components/ui";
import { api, type SellerOrder, type Stats } from "@/lib/api";
import { shortDate, xof } from "@/lib/format";

type Filter = "all" | "active" | "done";

export default function DashboardPage() {
  const { t, locale } = useI18n();
  const { me } = useMe();
  const errorText = useErrorText();
  const [filter, setFilter] = useState<Filter>("all");
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      try {
        const [list, s] = await Promise.all([
          api<{ orders: SellerOrder[]; next_before: string | null }>("GET", `/orders?status=${filter}`),
          api<Stats>("GET", "/stats"),
        ]);
        setOrders(list.orders);
        setNextBefore(list.next_before);
        setStats(s);
        setError(null);
      } catch (err) {
        if (!silent) setError(errorText(err));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter],
  );

  useEffect(() => {
    setOrders(null);
    void load();
    // Orders change when customers pay; refresh quietly while the tab is visible.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 8000);
    return () => clearInterval(timer);
  }, [load]);

  async function loadMore() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const list = await api<{ orders: SellerOrder[]; next_before: string | null }>("GET", `/orders?status=${filter}&before=${encodeURIComponent(nextBefore)}`);
      setOrders((prev) => [...(prev ?? []), ...list.orders]);
      setNextBefore(list.next_before);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const cards = stats
    ? [
        { label: t.app.stats.locked, value: xof(stats.locked_xof), sub: String(stats.locked), tone: "bg-sky" },
        { label: t.app.stats.week, value: xof(stats.delivered_7d_xof), sub: String(stats.delivered_7d), tone: "bg-mint" },
        { label: t.app.stats.waiting, value: String(stats.waiting), sub: null, tone: "bg-butter" },
        { label: t.app.stats.total, value: String(stats.delivered_total), sub: null, tone: "bg-card" },
      ]
    : [];

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-[2rem] bg-indigo-deep px-6 py-7 text-card shadow-block sm:px-9 sm:py-9">
        <div className="absolute -top-32 -right-20 size-80 rounded-full border border-white/10" aria-hidden="true">
          <div className="absolute inset-8 rounded-full border border-white/10" />
        </div>
        <div className="relative flex flex-wrap items-end justify-between gap-8">
          <div>
            <p className="eyebrow text-card/65">{t.app.greeting(me.seller.shop_name)}</p>
            <h1 className="mt-3 text-4xl font-semibold sm:text-5xl">{t.app.nav.orders}</h1>
          </div>
          {stats && (
            <div className="min-w-44 border-l border-white/20 pl-5 sm:pl-7">
              <p className="text-sm font-medium text-card/70">{t.app.stats.locked}</p>
              <p className="tabular mt-1 font-display text-3xl font-semibold sm:text-4xl">{xof(stats.locked_xof)}</p>
            </div>
          )}
          <Link href="/app/new" className={buttonClass("secondary", "md", "bg-card text-indigo-deep")}>
            <IconPlus width={18} height={18} />
            {t.app.nav.new}
          </Link>
        </div>
      </section>

      {!me.wallet ? (
        <section className="relative overflow-hidden rounded-[2rem] border border-line bg-sky shadow-soft">
          <div className="absolute -right-20 -top-24 hidden size-72 rounded-full border border-indigo/10 sm:block" />
          <div className="relative p-6 sm:w-2/3 sm:p-8">
            <span className="flex size-12 items-center justify-center rounded-full border-2 border-ink bg-card">
              <IconWallet />
            </span>
            <h2 className="mt-4 text-3xl font-semibold">{t.app.walletMissing.title}</h2>
            <p className="mt-2 text-ink-soft">{t.app.walletMissing.body}</p>
            <Link href="/app/wallet" className={buttonClass("primary", "md", "mt-6")}>
              {t.app.walletMissing.cta}
              <IconArrow />
            </Link>
          </div>
        </section>
      ) : (
        !me.wallet.healthy && <Notice tone="warn">{t.app.walletDown}</Notice>
      )}

      {stats && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {cards.map((c) => (
            <div key={c.label} className={`rounded-2xl border border-line ${c.tone} p-4 shadow-soft sm:p-5`}>
              <dt className="text-sm font-semibold text-ink-soft">{c.label}</dt>
              <dd className="tabular mt-2 font-display text-[1.7rem] leading-none font-semibold sm:text-4xl">{c.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <section>
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
          {(["all", "active", "done"] as Filter[]).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={`min-h-10 rounded-full border px-4 text-sm font-semibold whitespace-nowrap transition-colors ${filter === f ? "border-indigo-deep bg-indigo-deep text-card" : "border-line bg-card text-ink-soft hover:border-indigo/40 hover:text-ink"}`}
            >
              {t.app.filters[f]}
            </button>
          ))}
        </div>

        {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}

        {orders === null && !error ? (
          <div className="flex justify-center py-16"><Spinner className="size-7 text-ink-soft" /></div>
        ) : orders && orders.length === 0 ? (
          <div className="mt-4 rounded-[2rem] border-2 border-dashed border-ink/40 px-6 py-14 text-center">
            <h2 className="text-3xl font-semibold">{t.app.empty.title}</h2>
            <p className="mx-auto mt-2 max-w-sm text-ink-soft">{t.app.empty.body}</p>
            {me.wallet && (
              <Link href="/app/new" className={buttonClass("primary", "md", "mt-6")}>
                <IconPlus width={20} height={20} />
                {t.app.empty.cta}
              </Link>
            )}
          </div>
        ) : (
          <ul className="mt-4 overflow-hidden rounded-2xl border border-line bg-card shadow-soft">
            {orders?.map((o, i) => (
              <li key={o.id} className={i > 0 ? "border-t-2 border-line" : ""}>
                <Link href={`/app/orders/${o.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-paper sm:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[1.05rem] font-semibold">{o.title}</p>
                    <p className="mt-0.5 truncate text-sm text-ink-soft">
                      {o.customer_label ? `${t.app.forLabel(o.customer_label)} · ` : ""}
                      {shortDate(o.created_at, locale)}
                    </p>
                    <div className="mt-2 sm:hidden"><StatusBadge status={o.status} label={t.status[o.status]} /></div>
                  </div>
                  <div className="hidden sm:block"><StatusBadge status={o.status} label={t.status[o.status]} /></div>
                  <p className="tabular w-28 text-right font-display text-xl font-semibold">{xof(o.total_xof)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {nextBefore && (
          <div className="mt-5 flex justify-center">
            <Button variant="secondary" size="sm" onClick={loadMore} busy={loadingMore}>{t.app.more}</Button>
          </div>
        )}
      </section>
    </div>
  );
}
