"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconCopy, IconLock, IconMoto, IconReturn, IconWhatsApp } from "@/components/icons";
import { useErrorText, useI18n } from "@/components/i18n";
import { Button, buttonClass, Notice, Spinner, Stamp, Stars, StatusBadge } from "@/components/ui";
import { api, ApiError, type SellerOrder } from "@/lib/api";
import { clock, countdown, dateTime, sats, xof } from "@/lib/format";

const LIVE = ["open", "awaiting_payment", "funded", "settling", "refunding"];

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t, locale } = useI18n();
  const errorText = useErrorText();
  const O = t.order;
  const [order, setOrder] = useState<SellerOrder | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setOrder(await api<SellerOrder>("GET", `/orders/${id}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = order ? LIVE.includes(order.status) : false;
  useEffect(() => {
    if (!live) return;
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 3000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [live, load]);

  async function act(name: "dispatch" | "cancel") {
    if (!order) return;
    if (name === "cancel" && !window.confirm(order.status === "funded" ? O.actions.confirmRefund : O.actions.confirmCancel)) return;
    setBusy(name);
    setError(null);
    try {
      setOrder(await api<SellerOrder>("POST", `/orders/${order.id}/${name}`));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function copyLink() {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.share_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t.common.copy, order.share_url);
    }
  }

  if (missing) return <p className="py-20 text-center text-lg">{t.errors.not_found}</p>;
  if (!order) return <div className="flex justify-center py-20"><Spinner className="size-7 text-ink-soft" /></div>;

  const total = xof(order.total_xof);
  const waUrl = `https://wa.me/?text=${encodeURIComponent(O.share.message(order.title, total, order.share_url))}`;
  const remaining = order.deadline_at ? countdown(order.deadline_at, now) : null;
  const stages = ["open", "awaiting_payment", "funded", "completed"] as const;
  const activeStage =
    order.status === "completed" ? 3 :
    order.status === "funded" || order.status === "settling" ? 2 :
    order.status === "awaiting_payment" ? 1 :
    order.status === "open" ? 0 : -1;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/app" className="inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-ink">← {t.app.nav.orders}</Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <StatusBadge status={order.status} label={t.status[order.status]} />
          <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">{order.title}</h1>
          {order.customer_label && <p className="mt-1 text-ink-soft">{t.app.forLabel(order.customer_label)}</p>}
        </div>
        <div className="text-right">
          <p className="tabular font-display text-4xl font-semibold">{total}</p>
          {order.amount_sats && <p className="tabular text-sm text-ink-soft">{sats(order.amount_sats)}</p>}
        </div>
      </header>

      {error && <Notice tone="error">{error}</Notice>}

      {activeStage >= 0 && (
        <section className="rounded-[1.75rem] border border-line bg-card p-5 shadow-soft sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <p className="eyebrow text-indigo">{O.timeline}</p>
            <StatusBadge status={order.status} label={t.status[order.status]} />
          </div>
          <ol className="grid grid-cols-4 gap-1">
            {stages.map((stage, i) => (
              <li key={stage} className="relative flex min-w-0 flex-col items-center text-center">
                {i < stages.length - 1 && (
                  <span className={`absolute top-3.5 left-1/2 h-px w-full ${i < activeStage ? "bg-indigo" : "bg-line"}`} aria-hidden="true" />
                )}
                <span className={`relative z-10 flex size-7 items-center justify-center rounded-full border text-xs font-semibold ${i <= activeStage ? "border-indigo-deep bg-indigo-deep text-card" : "border-line bg-card text-ink-faint"}`}>
                  {i < activeStage ? <IconCheck width={14} height={14} strokeWidth={3} /> : i + 1}
                </span>
                <span className={`mt-2 max-w-full truncate text-[0.68rem] font-semibold sm:text-xs ${i <= activeStage ? "text-ink" : "text-ink-faint"}`}>
                  {t.status[stage]}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* The one thing to do next, by state. */}
      {order.status === "open" && (
        <section className="rounded-[2rem] border-2 border-ink bg-butter p-6 sm:p-8">
          <h2 className="text-2xl font-semibold sm:text-3xl">{O.share.title}</h2>
          <p className="mt-1 text-ink-soft">{O.share.body}</p>
          <button onClick={copyLink} className="mt-5 flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-ink bg-card px-4 py-3.5 text-left">
            <span className="truncate font-mono text-[0.95rem]">{order.share_url.replace(/^https?:\/\//, "")}</span>
            <span className="flex shrink-0 items-center gap-1.5 text-sm font-semibold">
              {copied ? <IconCheck width={18} height={18} className="text-leaf" /> : <IconCopy width={18} height={18} />}
              {copied ? t.common.copied : t.common.copy}
            </span>
          </button>
          <a href={waUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md", "mt-4 w-full sm:w-auto")}>
            <IconWhatsApp />
            {O.share.whatsapp}
          </a>
        </section>
      )}

      {order.status === "awaiting_payment" && (
        <section className="flex items-center gap-4 rounded-[2rem] border-2 border-ink bg-butter p-6">
          <Spinner className="size-7 shrink-0" />
          <div>
            <h2 className="text-2xl font-semibold">{O.waitingPay.title}</h2>
            <p className="text-ink-soft">{O.waitingPay.body}</p>
          </div>
        </section>
      )}

      {(order.status === "funded" || order.status === "settling") && (
        <section className="relative rounded-[2rem] border-2 border-ink bg-sky p-6 sm:p-8">
          <Stamp tone="indigo" animate className="absolute top-5 right-5 hidden bg-card sm:inline-block">{t.status.funded}</Stamp>
          <span className="flex size-12 items-center justify-center rounded-full border-2 border-ink bg-sun"><IconLock /></span>
          <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">{O.funded.title}</h2>
          <p className="mt-1 max-w-xl text-ink-soft">{O.funded.body}</p>
          {remaining && <p className="tabular mt-3 text-sm font-semibold text-indigo-deep">{O.funded.deadline(remaining)}</p>}
          <div className="mt-5">
            {order.dispatched_at ? (
              <p className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-mint px-4 py-2.5 font-semibold text-leaf">
                <IconMoto width={20} height={20} />
                {O.funded.dispatched} · {clock(order.dispatched_at, locale)}
              </p>
            ) : (
              <Button variant="indigo" onClick={() => act("dispatch")} busy={busy === "dispatch"} disabled={order.status !== "funded"}>
                <IconMoto />
                {O.funded.dispatch}
              </Button>
            )}
          </div>
          <div className="mt-6 rounded-2xl border-2 border-dashed border-ink/40 bg-card/60 p-4">
            <p className="font-semibold">{O.funded.riderTitle}</p>
            <p className="mt-1 text-[0.95rem] text-ink-soft">{O.funded.riderBody}</p>
          </div>
        </section>
      )}

      {order.status === "completed" && (
        <section className="relative rounded-[2rem] border-2 border-ink bg-mint p-6 sm:p-8">
          <Stamp tone="leaf" className="absolute top-5 right-5 bg-card">{t.landing.ticket.paid}</Stamp>
          <span className="flex size-12 items-center justify-center rounded-full border-2 border-ink bg-card text-leaf"><IconCheck strokeWidth={3} /></span>
          <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">{O.completed.title}</h2>
          <p className="mt-1 text-ink-soft">{O.completed.body(total)}</p>
          {order.rating && (
            <div className="mt-5 rounded-2xl border-2 border-ink bg-card p-4">
              <p className="flex items-center gap-3 text-sm font-semibold">{O.rating}<Stars value={order.rating} /></p>
              {order.review && <p className="mt-2 font-display text-lg italic">«&nbsp;{order.review}&nbsp;»</p>}
            </div>
          )}
        </section>
      )}

      {(order.status === "refunded" || order.status === "refunding") && (
        <section className="rounded-[2rem] border-2 border-ink bg-blush p-6 sm:p-8">
          <span className="flex size-12 items-center justify-center rounded-full border-2 border-ink bg-card"><IconReturn /></span>
          <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">{O.refunded.title}</h2>
          <p className="mt-1 text-ink-soft">{O.refunded.reasons[order.close_reason ?? ""] ?? ""}</p>
        </section>
      )}

      {order.status === "cancelled" && (
        <section className="rounded-[2rem] border-2 border-ink bg-sand p-6 sm:p-8">
          <h2 className="text-2xl font-semibold sm:text-3xl">{O.cancelled.title}</h2>
          <p className="mt-1 text-ink-soft">{O.cancelled.body}</p>
        </section>
      )}

      {/* Order lines */}
      <section className="rounded-[2rem] border-2 border-ink bg-card p-6">
        <div className="flex gap-4">
          {order.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={order.image_url} alt="" className="size-24 shrink-0 rounded-2xl border-2 border-ink object-cover" />
          )}
          <div className="min-w-0 flex-1">
            {order.description && <p className="text-ink-soft">{order.description}</p>}
            <dl className="tabular mt-2 space-y-1.5">
              <div className="flex justify-between gap-4"><dt className="text-ink-soft">{t.common.item}</dt><dd className="font-medium">{xof(order.amount_xof)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-ink-soft">{t.common.delivery}</dt><dd className="font-medium">{xof(order.delivery_fee_xof)}</dd></div>
              <div className="dash-rule" />
              <div className="flex justify-between gap-4 text-lg"><dt className="font-semibold">{t.common.total}</dt><dd className="font-semibold">{total}</dd></div>
            </dl>
          </div>
        </div>
      </section>

      {order.events && order.events.length > 0 && (
        <section>
          <h2 className="text-xl font-semibold">{O.timeline}</h2>
          <ol className="mt-4 space-y-0">
            {order.events.map((e, i) => (
              <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
                {i < order.events!.length - 1 && <span className="absolute top-3 left-[5px] h-full border-l-2 border-dashed border-line" />}
                <span className={`relative mt-1.5 size-3 shrink-0 rounded-full border-2 border-ink ${i === order.events!.length - 1 ? "bg-sun" : "bg-card"}`} />
                <div>
                  <p className="font-medium">{O.events[e.type] ?? e.type}</p>
                  <p className="text-sm text-ink-faint">{dateTime(e.at, locale)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {["open", "awaiting_payment", "funded"].includes(order.status) && (
        <div className="border-t-2 border-line pt-5">
          <Button variant="danger" size="sm" onClick={() => act("cancel")} busy={busy === "cancel"}>
            {order.status === "funded" ? O.actions.refund : O.actions.cancel}
          </Button>
        </div>
      )}
    </div>
  );
}
