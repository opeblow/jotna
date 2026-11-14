"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { LanguageSwitch, useErrorText, useI18n } from "@/components/i18n";
import { Qr } from "@/components/Qr";
import { Button, Field, Input, Logo, Notice, Spinner, Stars, StatusBadge } from "@/components/ui";
import { api, ApiError, type PublicOrder } from "@/lib/api";
import { countdown, sats, windowLabel, xof } from "@/lib/format";
import { deriveSecrets, formatCode, generateCode, isValidCode, loadCode, normalizeCode, saveCode } from "@/lib/secrets";

const LIVE = ["awaiting_payment", "funded", "settling", "refunding"];

export default function BuyerOrderPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const errorText = useErrorText();
  const B = t.buyer;
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [readyId, setReadyId] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [origin, setOrigin] = useState("");
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [stars, setStars] = useState(5);
  const [review, setReview] = useState("");
  const [rated, setRated] = useState(false);

  const activeCode = readyId === id ? code : null;
  const secrets = useMemo(() => activeCode ? deriveSecrets(id, activeCode) : null, [activeCode, id]);
  const secretsRef = useRef(secrets);
  secretsRef.current = secrets;

  useEffect(() => {
    setCode(loadCode(id));
    setReadyId(id);
    setOrder(null);
    setMissing(false);
    setError(null);
    setRecoveryError(null);
    setOrigin(window.location.origin);
  }, [id]);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const current = await api<PublicOrder>("GET", `/public/orders/${id}`, {
        headers: secretsRef.current ? { "x-jotna-buyer": secretsRef.current.buyerKey } : undefined,
        signal,
      });
      setOrder(current);
      setMissing(false);
      setError(null);
      return current;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
      else if ((err as Error).name !== "AbortError") setError(err);
      return null;
    }
  }, [id]);

  useEffect(() => {
    if (readyId !== id) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [id, load, readyId]);

  const live = Boolean(order && LIVE.includes(order.status));
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [live, load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function beginCheckout(rotateCode = false) {
    if (!order) return;
    const buyerCode = activeCode && !rotateCode ? activeCode : generateCode();
    const saved = saveCode(id, buyerCode);
    setCode(buyerCode);
    setReadyId(id);
    setStorageWarning(!saved);
    setBusy("checkout");
    setError(null);
    try {
      const buyerSecrets = deriveSecrets(id, buyerCode);
      const next = await api<PublicOrder>("POST", `/public/orders/${id}/checkout`, {
        body: { payment_hash: buyerSecrets.paymentHash, buyer_key_hash: buyerSecrets.buyerKeyHash },
      });
      setOrder({ ...next, is_buyer: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function recoverOrder(event: FormEvent) {
    event.preventDefault();
    const buyerCode = normalizeCode(recoveryCode);
    if (!isValidCode(buyerCode)) {
      setRecoveryError(B.funded.lost.wrong);
      return;
    }
    setBusy("recover");
    setRecoveryError(null);
    try {
      const buyerSecrets = deriveSecrets(id, buyerCode);
      const recovered = await api<PublicOrder>("GET", `/public/orders/${id}`, {
        headers: { "x-jotna-buyer": buyerSecrets.buyerKey },
      });
      if (!recovered.is_buyer && recovered.status !== "open") {
        setRecoveryError(B.funded.lost.wrong);
        return;
      }
      const saved = saveCode(id, buyerCode);
      setCode(buyerCode);
      setReadyId(id);
      setStorageWarning(!saved);
      setOrder(recovered);
      setRecoveryCode("");
    } catch (err) {
      setRecoveryError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function cancelOrder() {
    if (!order || !secrets || !window.confirm(B.funded.confirmCancel)) return;
    setBusy("cancel");
    setError(null);
    try {
      setOrder(await api<PublicOrder>("POST", `/public/orders/${id}/cancel`, {
        body: { buyer_key: secrets.buyerKey },
      }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function payWithTestWallet() {
    if (!order?.payment) return;
    setBusy("devPay");
    setError(null);
    try {
      await api("POST", "/dev/pay", { body: { bolt11: order.payment.bolt11 } });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function rateDelivery(event: FormEvent) {
    event.preventDefault();
    if (!secrets) return;
    setBusy("rating");
    setError(null);
    try {
      const result = await api<PublicOrder>("POST", `/public/orders/${id}/rating`, {
        body: { buyer_key: secrets.buyerKey, stars, review: review.trim() || null },
      });
      setOrder(result);
      setRated(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(t.common.copy, value);
    }
  }

  if (missing) {
    return <main className="wrap flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 py-10 text-center">
      <Logo />
      <h1 className="font-display text-4xl font-semibold">{B.notFound.title}</h1>
      <p className="text-ink-soft">{B.notFound.body}</p>
    </main>;
  }

  if (!order && error && readyId === id) {
    return <main className="wrap flex min-h-dvh max-w-xl flex-col items-center justify-center gap-6 py-10 text-center">
      <Logo />
      <Notice tone="error">{errorText(error)}</Notice>
      <Button variant="secondary" onClick={() => void load()}>{t.common.retry}</Button>
    </main>;
  }

  if (!order || readyId !== id) {
    return <main className="wrap flex min-h-dvh items-center justify-center"><Spinner className="size-8 text-ink-soft" /></main>;
  }

  const total = xof(order.total_xof);
  const invoiceTime = order.payment ? countdown(order.payment.expires_at, now) : null;
  const invoiceExpired = Boolean(order.payment && !invoiceTime);
  const buyerOwnsOrder = order.is_buyer;
  const needsRecovery = !buyerOwnsOrder && order.status !== "open";
  const riderUrl = origin && activeCode ? `${origin}/r/${id}#${activeCode}` : "";

  return (
    <main className="min-h-dvh bg-paper pb-12">
      <header className="wrap flex items-center justify-between gap-4 py-5">
        <Logo />
        <LanguageSwitch />
      </header>

      <div className="wrap max-w-3xl space-y-6">
        <header className="rounded-[2rem] border-2 border-ink bg-card p-5 shadow-block-sm sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow text-indigo">{B.from} {order.shop.name}</p>
              <h1 className="mt-2 break-words font-display text-3xl font-semibold sm:text-5xl">{order.title}</h1>
              <p className="mt-2 text-sm text-ink-soft">{B.deliveredCount(order.shop.delivered_count)}</p>
            </div>
            <StatusBadge status={order.status} label={t.status[order.status]} />
          </div>
          {order.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={order.image_url} alt="" className="mt-5 max-h-72 w-full rounded-2xl border-2 border-ink object-cover" />
          )}
          {order.description && <p className="mt-4 whitespace-pre-wrap text-ink-soft">{order.description}</p>}
          <dl className="tabular mt-5 space-y-2 border-t border-line pt-4">
            <div className="flex justify-between gap-4"><dt className="text-ink-soft">{t.common.item}</dt><dd>{xof(order.amount_xof)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-soft">{t.common.delivery}</dt><dd>{xof(order.delivery_fee_xof)}</dd></div>
            <div className="flex justify-between gap-4 border-t border-line pt-2 text-lg font-semibold"><dt>{t.common.total}</dt><dd>{total}</dd></div>
          </dl>
        </header>

        {error !== null && <Notice tone="error">{errorText(error)}</Notice>}

        {needsRecovery && (
          <RecoveryForm
            title={B.funded.lost.title}
            body={B.funded.lost.body}
            label={B.funded.lost.label}
            button={B.funded.lost.cta}
            value={recoveryCode}
            error={recoveryError}
            busy={busy === "recover"}
            onChange={setRecoveryCode}
            onSubmit={recoverOrder}
          />
        )}

        {order.status === "open" && (
          <section className="rounded-[2rem] border-2 border-ink bg-butter p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold sm:text-3xl">{B.open.promiseTitle}</h2>
            <ul className="mt-4 space-y-2 text-ink-soft">
              {B.open.promises.map((promise) => <li key={promise}>• {promise}</li>)}
            </ul>
            <div className="mt-5 flex flex-wrap gap-3 text-sm font-semibold">
              {order.quote && <span className="rounded-full border border-line bg-card px-3 py-1.5">{B.open.about(sats(order.quote.amount_sats))}</span>}
              <span className="rounded-full border border-line bg-card px-3 py-1.5">{B.open.window(windowLabel(order.delivery_window_minutes))}</span>
            </div>
            {!order.quote && <Notice tone="warn">{t.errors.rate_unavailable}</Notice>}
            <Button className="mt-6 w-full sm:w-auto" size="lg" onClick={() => void beginCheckout()} busy={busy === "checkout"} disabled={!order.quote || busy !== null}>
              {busy === "checkout" ? B.open.preparing : B.open.pay}
            </Button>
          </section>
        )}

        {order.status === "awaiting_payment" && buyerOwnsOrder && (
          <section className="rounded-[2rem] border-2 border-ink bg-sky p-6 sm:p-8">
            {order.payment && !invoiceExpired ? (
              <>
                <h2 className="font-display text-2xl font-semibold sm:text-3xl">{B.pay.title}</h2>
                <p className="mt-2 text-ink-soft">{B.pay.body}</p>
                <div className="mx-auto mt-5 w-fit rounded-2xl border-2 border-ink bg-card p-3">
                  <Qr value={order.payment.bolt11} size={240} label={B.pay.title} />
                </div>
                <p className="mt-4 text-center text-sm font-semibold text-ink-soft">{B.pay.expires(invoiceTime!)}</p>
                <p className="mt-2 rounded-xl bg-card/70 p-3 text-sm text-ink-soft">{B.pay.pending}</p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <a className="inline-flex min-h-12 items-center justify-center rounded-full border-2 border-ink bg-card px-6 font-semibold hover:bg-sand" href={`lightning:${order.payment.bolt11}`}>
                    {B.pay.openWallet}
                  </a>
                  <Button variant="secondary" onClick={() => void copy(order.payment!.bolt11)}>{copied ? t.common.copied : B.pay.copyInvoice}</Button>
                </div>
                {order.dev_pay_enabled && (
                  <Button className="mt-4 w-full" variant="indigo" onClick={() => void payWithTestWallet()} busy={busy === "devPay"}>
                    {busy === "devPay" ? B.pay.devPaying : B.pay.devPay}
                  </Button>
                )}
              </>
            ) : (
              <>
                <h2 className="font-display text-2xl font-semibold">{B.pay.expired}</h2>
                <Button className="mt-4" onClick={() => void beginCheckout(true)} busy={busy === "checkout"} disabled={busy !== null}>{B.pay.again}</Button>
              </>
            )}
            {activeCode && <CodeCard code={activeCode} title={B.funded.codeTitle} body={B.funded.codeBody} warning={storageWarning} onCopy={() => void copy(formatCode(activeCode))} copied={copied} />}
          </section>
        )}

        {order.status === "funded" && buyerOwnsOrder && (
          <section className="rounded-[2rem] border-2 border-ink bg-sky p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold sm:text-3xl">{B.funded.title}</h2>
            <p className="mt-2 text-ink-soft">{B.funded.body}</p>
            <p className="mt-4 rounded-xl border border-line bg-card p-3 font-semibold">{order.dispatched_at ? B.funded.dispatched : B.funded.notYet}</p>
            {order.deadline_at && <p className="mt-3 text-sm font-semibold text-indigo-deep">{B.funded.deadline(countdown(order.deadline_at, now) ?? "0s")}</p>}
            {order.dispatched_at && <Notice tone="warn">{B.funded.cancelBlocked}</Notice>}
            {activeCode && riderUrl && (
              <div className="mt-6 rounded-2xl border-2 border-ink bg-card p-5 text-center">
                <h3 className="font-semibold">{B.funded.qrTitle}</h3>
                <p className="mt-1 text-sm text-ink-soft">{B.funded.qrBody}</p>
                <div className="mx-auto mt-4 w-fit"><Qr value={riderUrl} size={220} label={B.funded.qrTitle} /></div>
                <CodeCard code={activeCode} title={B.funded.codeTitle} body={B.funded.codeBody} warning={storageWarning} onCopy={() => void copy(formatCode(activeCode))} copied={copied} />
              </div>
            )}
            {order.can_cancel && (
              <div className="mt-5">
                <Button className="mt-4" variant="danger" onClick={() => void cancelOrder()} busy={busy === "cancel"} disabled={Boolean(order.dispatched_at)}>
                  {B.funded.cancel}
                </Button>
              </div>
            )}
          </section>
        )}

        {order.status === "settling" && <Notice>{B.settling.title}. {B.settling.body}</Notice>}
        {order.status === "refunding" && <Notice tone="warn">{B.refunded.title}. {B.refunded.body}</Notice>}

        {order.status === "completed" && (
          <section className="rounded-[2rem] border-2 border-ink bg-mint p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold sm:text-3xl">{B.completed.title}</h2>
            <p className="mt-2 text-ink-soft">{B.completed.body(total, order.shop.name)}</p>
            {order.rating ? (
              <div className="mt-5 flex items-center gap-3"><Stars value={order.rating} /><span className="text-sm text-ink-soft">{B.completed.thanks}</span></div>
            ) : buyerOwnsOrder && secrets && (
              rated ? (
                <div className="mt-5"><Notice>{B.completed.thanks}</Notice></div>
              ) : (
                <form onSubmit={rateDelivery} className="mt-5 space-y-4 rounded-2xl border border-line bg-card p-4">
                  <label className="block">
                    <span className="mb-2 block font-semibold">{B.completed.rate}</span>
                    <select className="min-h-12 w-full rounded-xl border border-line bg-card px-3" value={stars} onChange={(event) => setStars(Number(event.target.value))}>
                      {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} / 5</option>)}
                    </select>
                  </label>
                  <Field label={B.completed.reviewPh} optional={t.common.optional}>
                    <Input value={review} maxLength={280} onChange={(event) => setReview(event.target.value)} />
                  </Field>
                  <Button type="submit" busy={busy === "rating"}>{B.completed.send}</Button>
                </form>
              )
            )}
          </section>
        )}

        {(order.status === "refunded" || order.status === "refunding") && order.status === "refunded" && (
          <section className="rounded-[2rem] border-2 border-ink bg-blush p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold">{B.refunded.title}</h2>
            <p className="mt-2 text-ink-soft">{B.refunded.reasons[order.close_reason ?? ""] ?? B.refunded.body}</p>
          </section>
        )}

        {order.status === "cancelled" && (
          <section className="rounded-[2rem] border-2 border-ink bg-sand p-6 sm:p-8">
            <h2 className="font-display text-2xl font-semibold">{B.cancelled.title}</h2>
            <p className="mt-2 text-ink-soft">{B.cancelled.body}</p>
          </section>
        )}

      </div>
    </main>
  );
}

function CodeCard({
  code,
  title,
  body,
  warning,
  copied,
  onCopy,
}: {
  code: string;
  title: string;
  body: string;
  warning: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-5 rounded-2xl border border-line bg-card p-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-ink-soft">{body}</p>
      {warning && <p className="mt-2 text-sm font-semibold text-clay-deep">{t.buyer.funded.storageWarning}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <code className="rounded-lg bg-sand px-3 py-2 font-mono text-lg font-bold tracking-wider">{formatCode(code)}</code>
        <Button type="button" variant="secondary" size="sm" onClick={onCopy}>{copied ? t.common.copied : t.common.copy}</Button>
      </div>
    </div>
  );
}

function RecoveryForm({
  title,
  body,
  label,
  button,
  value,
  error,
  busy,
  onChange,
  onSubmit,
}: {
  title: string;
  body: string;
  label: string;
  button: string;
  value: string;
  error: string | null;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { t } = useI18n();
  return (
    <form onSubmit={onSubmit} className="rounded-[2rem] border-2 border-ink bg-butter p-6 sm:p-8">
      <h2 className="font-display text-2xl font-semibold">{title}</h2>
      <p className="mt-2 text-ink-soft">{body}</p>
      <Field label={label}>
        <Input
          className="mt-3 font-mono uppercase tracking-widest"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={19}
          required
        />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button className="mt-4" type="submit" busy={busy} disabled={busy}>{button}</Button>
    </form>
  );
}
