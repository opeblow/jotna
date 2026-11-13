"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMe } from "@/components/AppShell";
import { IconArrow, IconLock, IconShield, IconWallet } from "@/components/icons";
import { useErrorText, useI18n } from "@/components/i18n";
import { Button, Field, Input, Notice, Textarea } from "@/components/ui";
import { api } from "@/lib/api";

export default function WalletPage() {
  const { t } = useI18n();
  const { me, refresh } = useMe();
  const errorText = useErrorText();
  const router = useRouter();
  const W = t.wallet;

  const [tab, setTab] = useState<"nwc" | "lnd">("nwc");
  const [uri, setUri] = useState("");
  const [restUrl, setRestUrl] = useState("");
  const [macaroon, setMacaroon] = useState("");
  const [cert, setCert] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function connect(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const body =
        tab === "nwc"
          ? { kind: "nwc", connection_uri: uri.trim() }
          : { kind: "lnd", rest_url: restUrl.trim(), macaroon_hex: macaroon.trim(), tls_cert_pem: cert.trim() || undefined };
      await api("PUT", "/wallet", { body });
      setUri("");
      setMacaroon("");
      await refresh();
      if (new URLSearchParams(window.location.search).has("welcome")) router.replace("/app/new");
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setChecking(true);
    setNotice(null);
    try {
      const res = await api<{ ok: boolean }>("POST", "/wallet/check");
      setNotice(res.ok ? { tone: "success", text: W.ok } : { tone: "error", text: t.errors.wallet_unreachable! });
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    } finally {
      setChecking(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(W.confirmDisconnect)) return;
    setNotice(null);
    try {
      await api("DELETE", "/wallet");
      await refresh();
    } catch (err) {
      setNotice({ tone: "error", text: errorText(err) });
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow text-indigo">{t.app.nav.wallet}</p>
      <h1 className="mt-2 text-4xl font-semibold sm:text-5xl">{W.title}</h1>
      <p className="mt-3 max-w-2xl text-lg text-ink-soft">{W.sub}</p>

      <section className="mt-6 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-[1.75rem] bg-indigo-deep p-3 text-center text-card shadow-soft sm:gap-4 sm:p-5" aria-label={t.landing.security.title}>
        <p className="rounded-2xl bg-white/10 px-2 py-3 text-xs font-semibold sm:px-4 sm:py-4 sm:text-sm">{t.landing.security.diagram.buyer}</p>
        <IconArrow className="size-4 text-card/60 sm:size-5" />
        <p className="flex flex-col items-center gap-1 rounded-2xl bg-white/10 px-2 py-3 text-xs font-semibold sm:px-4 sm:py-4 sm:text-sm">
          <IconLock width={18} height={18} />
          {t.landing.security.diagram.lock}
        </p>
        <IconArrow className="size-4 text-card/60 sm:size-5" />
        <p className="rounded-2xl bg-white/10 px-2 py-3 text-xs font-semibold sm:px-4 sm:py-4 sm:text-sm">{t.landing.security.diagram.seller}</p>
      </section>

      {notice && <div className="mt-6"><Notice tone={notice.tone}>{notice.text}</Notice></div>}

      {me.wallet ? (
        <section className="mt-7 rounded-[2rem] border-2 border-ink bg-card p-6 shadow-block sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className={`flex size-14 items-center justify-center rounded-full border-2 border-ink ${me.wallet.healthy ? "bg-mint" : "bg-blush"}`}>
                <IconWallet width={26} height={26} />
              </span>
              <div>
                <p className="font-display text-2xl font-semibold">{me.wallet.alias || (me.wallet.kind === "nwc" ? "Nostr Wallet Connect" : "LND")}</p>
                <p className={`flex items-center gap-1.5 text-sm font-semibold ${me.wallet.healthy ? "text-leaf" : "text-clay-deep"}`}>
                  <span className="size-2 rounded-full bg-current" />
                  {me.wallet.healthy ? W.connected : W.unreachable}
                  {me.wallet.network && <span className="font-normal text-ink-faint">· {me.wallet.network}</span>}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={check} busy={checking}>{checking ? W.checking : W.check}</Button>
              <Button variant="danger" size="sm" onClick={disconnect}>{W.disconnect}</Button>
            </div>
          </div>
        </section>
      ) : (
        <section className="mt-7 rounded-[2rem] border-2 border-ink bg-card p-6 sm:p-8">
          {me.features.lnd_connect && (
            <div className="mb-6 flex gap-2" role="tablist">
              {(["nwc", "lnd"] as const).map((k) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-10 rounded-full border-2 px-4 text-sm font-semibold ${tab === k ? "border-ink bg-ink text-card" : "border-line text-ink-soft hover:border-ink"}`}>
                  {W[k].tab}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={connect} className="space-y-5" noValidate>
            {tab === "nwc" ? (
              <>
                <h2 className="text-2xl font-semibold">{W.nwc.title}</h2>
                <ol className="space-y-3">
                  {W.nwc.steps.map((s, i) => (
                    <li key={s} className="flex gap-3">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-sun text-sm font-bold">{i + 1}</span>
                      <span className="text-ink-soft">{s}</span>
                    </li>
                  ))}
                </ol>
                <Field label={W.nwc.label}>
                  <Textarea rows={3} className="font-mono text-sm break-all" value={uri} onChange={(e) => setUri(e.target.value)} placeholder={W.nwc.ph} autoComplete="off" spellCheck={false} required />
                </Field>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-semibold">{W.lnd.title}</h2>
                <p className="font-mono text-sm text-ink-soft">{W.lnd.body}</p>
                <Field label={W.lnd.url}>
                  <Input value={restUrl} onChange={(e) => setRestUrl(e.target.value)} placeholder={W.lnd.urlPh} autoComplete="off" inputMode="url" required />
                </Field>
                <Field label={W.lnd.macaroon}>
                  <Textarea rows={3} className="font-mono text-sm break-all" value={macaroon} onChange={(e) => setMacaroon(e.target.value)} autoComplete="off" spellCheck={false} required />
                </Field>
                <Field label={W.lnd.cert} optional={t.common.optional}>
                  <Textarea rows={2} className="font-mono text-sm" value={cert} onChange={(e) => setCert(e.target.value)} autoComplete="off" spellCheck={false} />
                </Field>
              </>
            )}
            <Button type="submit" busy={busy} disabled={tab === "nwc" ? uri.trim().length < 20 : !restUrl.trim() || macaroon.trim().length < 20}>
              {busy ? W.connecting : W.connect}
            </Button>
          </form>
        </section>
      )}

      <section className="mt-6 overflow-hidden rounded-[2rem] border border-line bg-sky p-6 sm:p-8">
        <h2 className="flex items-center gap-3 text-2xl font-semibold text-indigo-deep">
          <span className="flex size-11 items-center justify-center rounded-full border border-line bg-card">
            <IconShield />
          </span>
          {W.why.title}
        </h2>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2">
          {W.why.points.map((p, i) => (
            <li key={p} className="flex gap-3 rounded-2xl border border-line bg-card/80 p-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-deep font-mono text-xs font-semibold text-card">{String(i + 1).padStart(2, "0")}</span>
              {p}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
