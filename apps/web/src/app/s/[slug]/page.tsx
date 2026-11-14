import type { Metadata } from "next";
import { IconCheck } from "@/components/icons";
import { LanguageSwitch } from "@/components/i18n";
import { ShellPattern } from "@/components/patterns";
import { Logo, Stars } from "@/components/ui";
import type { Shop } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { getDict } from "@/lib/locale";

interface ShopPage {
  shop: Shop;
  reviews: { stars: number; review: string | null; at: string }[];
  receipts: { ref: string; at: string; event_id: string | null }[];
  nostr_npub: string | null;
}

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4000";

/** Fetched on the server, so the page arrives complete on a slow connection. */
async function loadShop(slug: string): Promise<ShopPage | null> {
  if (!/^[a-z0-9-]{2,48}$/.test(slug)) return null;
  try {
    const res = await fetch(`${API_URL}/v1/public/shops/${slug}`, { next: { revalidate: 30 } });
    return res.ok ? ((await res.json()) as ShopPage) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = await loadShop((await params).slug);
  return { title: data?.shop.name ?? "Jotna" };
}

export default async function ShopReputationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ t, locale }, data] = await Promise.all([getDict(), loadShop(slug)]);
  const S = t.shop;

  if (!data) {
    return (
      <main className="wrap flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 py-10 text-center">
        <Logo />
        <h1 className="text-4xl font-semibold">{S.notFound}</h1>
      </main>
    );
  }

  const { shop, reviews, receipts } = data;
  return (
    <div className="min-h-dvh pb-16">
      <header className="wrap flex items-center justify-between gap-4 py-5">
        <Logo />
        <LanguageSwitch />
      </header>

      <main className="wrap max-w-3xl space-y-6">
        <section className="relative overflow-hidden rounded-[2rem] border-2 border-ink bg-card shadow-block">
          <ShellPattern className="h-16 w-full border-b-2 border-ink" />
          <div className="p-6 sm:p-8">
            <h1 className="text-4xl font-semibold break-words sm:text-5xl">{shop.name}</h1>
            <p className="mt-2 text-ink-soft">
              {shop.city ? `${shop.city} · ` : ""}
              {S.since(shortDate(shop.member_since, locale))}
            </p>
            <dl className="mt-6 grid grid-cols-2 gap-4">
              <div className="rounded-2xl border-2 border-ink bg-mint p-4">
                <dd className="tabular font-display text-5xl leading-none font-semibold">{shop.delivered_count}</dd>
                <dt className="mt-2 text-sm font-semibold text-ink-soft">{S.delivered}</dt>
              </div>
              <div className="rounded-2xl border-2 border-ink bg-butter p-4">
                <dd className="tabular font-display text-5xl leading-none font-semibold">
                  {shop.rating_avg !== null ? shop.rating_avg.toFixed(1).replace(".", locale === "fr" ? "," : ".") : "–"}
                </dd>
                <dt className="mt-2 text-sm font-semibold text-ink-soft">
                  {shop.rating_count > 0 ? `${S.rating} · ${S.ratings(shop.rating_count)}` : S.newShop}
                </dt>
              </div>
            </dl>
          </div>
        </section>

        <section className="rounded-[2rem] border-2 border-ink bg-card p-6 sm:p-8">
          <h2 className="text-2xl font-semibold">{S.reviews}</h2>
          {reviews.length === 0 ? (
            <p className="mt-3 text-ink-soft">{S.noReviews}</p>
          ) : (
            <ul className="mt-4 space-y-5">
              {reviews.map((r, i) => (
                <li key={i} className={i > 0 ? "border-t-2 border-line pt-5" : ""}>
                  <div className="flex items-center justify-between gap-3">
                    <Stars value={r.stars} />
                    <time dateTime={r.at} className="text-sm text-ink-faint">{shortDate(r.at, locale)}</time>
                  </div>
                  {r.review && <p className="mt-2 font-display text-xl break-words italic">«&nbsp;{r.review}&nbsp;»</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-[2rem] border-2 border-ink bg-card p-6 sm:p-8">
          <h2 className="text-2xl font-semibold">{S.receipts}</h2>
          <p className="mt-1 text-sm text-ink-soft">{S.verified}</p>
          {receipts.length === 0 ? (
            <p className="mt-4 text-ink-soft">{S.noReceipts}</p>
          ) : (
            <ul className="mt-4 divide-y-2 divide-line">
              {receipts.map((r) => (
                <li key={r.ref + r.at} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex items-center gap-2.5 font-medium">
                    <span className="flex size-6 items-center justify-center rounded-full bg-leaf text-card">
                      <IconCheck width={14} height={14} strokeWidth={3} />
                    </span>
                    <span className="font-mono text-sm tracking-wider uppercase">{r.ref}</span>
                  </span>
                  <time dateTime={r.at} className="text-sm text-ink-soft">{shortDate(r.at, locale)}</time>
                </li>
              ))}
            </ul>
          )}
          {data.nostr_npub && (
            <p className="mt-5 text-sm break-all text-ink-faint">
              {S.signedBy} <span className="font-mono">{data.nostr_npub}</span>
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
