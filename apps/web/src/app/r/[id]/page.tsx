"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LanguageSwitch, useErrorText, useI18n } from "@/components/i18n";
import { Button, Logo, Notice, Spinner, StatusBadge } from "@/components/ui";
import { api, ApiError, type PublicOrder } from "@/lib/api";
import { xof } from "@/lib/format";
import { deriveSecrets, isValidCode, normalizeCode } from "@/lib/secrets";

export default function RiderReleasePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const errorText = useErrorText();
  const R = t.release;
  const [code, setCode] = useState("");
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCode(normalizeCode(window.location.hash.slice(1)));
  }, [id]);

  const secrets = useMemo(() => isValidCode(code) ? deriveSecrets(id, code) : null, [code, id]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      setOrder(await api<PublicOrder>("GET", `/public/orders/${id}`, { signal }));
      setMissing(false);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
      else if ((err as Error).name !== "AbortError") setError(err);
    }
  }, [id]);

  useEffect(() => {
    setOrder(null);
    setMissing(false);
    setError(null);
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (order?.status !== "settling") return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [load, order?.status]);

  async function release() {
    if (!secrets || !order || !window.confirm(R.confirmBody(xof(order.total_xof), order.shop.name))) return;
    setBusy(true);
    setError(null);
    try {
      setOrder(await api<PublicOrder>("POST", `/public/orders/${id}/release`, { body: { preimage: secrets.preimage } }));
    } catch (err) {
      await load();
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh bg-paper">
      <header className="wrap flex items-center justify-between gap-4 py-5">
        <Logo />
        <LanguageSwitch />
      </header>
      <div className="wrap max-w-xl py-8">
        <section className="rounded-[2rem] border-2 border-ink bg-card p-6 shadow-block-sm sm:p-8">
          <p className="eyebrow text-indigo">{R.title}</p>
          {missing ? (
            <>
              <h1 className="mt-3 font-display text-3xl font-semibold">{t.buyer.notFound.title}</h1>
              <p className="mt-2 text-ink-soft">{t.buyer.notFound.body}</p>
            </>
          ) : !order && error ? (
            <div className="mt-5 space-y-4">
              <Notice tone="error">{errorText(error)}</Notice>
              <Button variant="secondary" onClick={() => void load()}>{t.common.retry}</Button>
            </div>
          ) : !order ? (
            <div className="flex justify-center py-16"><Spinner className="size-8 text-ink-soft" /></div>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="font-display text-3xl font-semibold">{order.title}</h1>
                  <p className="mt-1 text-ink-soft">{R.order} · {order.shop.name}</p>
                </div>
                <StatusBadge status={order.status} label={t.status[order.status]} />
              </div>
              <p className="tabular mt-5 border-t border-line pt-4 text-2xl font-semibold">{xof(order.total_xof)}</p>

              {error !== null && <div className="mt-5"><Notice tone="error">{errorText(error)}</Notice></div>}

              {!secrets ? (
                <div className="mt-5"><Notice tone="warn">{R.missing}</Notice></div>
              ) : order.status === "funded" ? (
                <>
                  <h2 className="mt-6 font-display text-2xl font-semibold">{R.confirmTitle}</h2>
                  <p className="mt-2 text-ink-soft">{R.confirmBody(xof(order.total_xof), order.shop.name)}</p>
                  <Button className="mt-6 w-full" size="lg" onClick={() => void release()} busy={busy}>{busy ? R.working : R.confirm}</Button>
                </>
              ) : order.status === "settling" ? (
                <div className="mt-6"><Notice>{R.settling}. {R.settlingBody}</Notice></div>
              ) : order.status === "completed" ? (
                <div className="mt-6"><Notice tone="success">{R.already}</Notice></div>
              ) : order.status === "refunded" || order.status === "refunding" ? (
                <div className="mt-6"><Notice tone="warn">{t.buyer.refunded.title}. {t.buyer.refunded.reasons[order.close_reason ?? ""] ?? t.buyer.refunded.body}</Notice></div>
              ) : order.status === "cancelled" ? (
                <div className="mt-6"><Notice tone="warn">{t.buyer.cancelled.title}. {t.buyer.cancelled.body}</Notice></div>
              ) : (
                <div className="mt-6"><Notice tone="warn">{t.errors.not_funded}</Notice></div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
