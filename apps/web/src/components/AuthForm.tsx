"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { IconCheck } from "@/components/icons";
import { LanguageSwitch, useErrorText, useI18n } from "@/components/i18n";
import { Button, Field, Input, Logo, Mark, Notice } from "@/components/ui";
import { api } from "@/lib/api";
import { xof } from "@/lib/format";

export function AuthForm({ mode }: { mode: "start" | "login" }) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const router = useRouter();
  const [shopName, setShopName] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const A = t.auth;
  const isStart = mode === "start";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isStart) {
        await api("POST", "/auth/signup", { body: { phone, pin, shop_name: shopName.trim(), city: city.trim() || null } });
        router.replace("/app/wallet?welcome=1");
      } else {
        await api("POST", "/auth/login", { body: { phone, pin } });
        router.replace("/app");
      }
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const ready = phone.replace(/\D/g, "").length >= 7 && /^\d{6}$/.test(pin) && (!isStart || shopName.trim().length >= 2);

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_0.85fr]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo />
          <LanguageSwitch />
        </div>

        <main className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-10">
          <h1 className="text-[2.6rem] font-semibold sm:text-5xl">{isStart ? A.startTitle : A.loginTitle}</h1>
          <p className="mt-3 text-lg text-ink-soft">{isStart ? A.startSub : A.loginSub}</p>

          <form onSubmit={submit} className="mt-8 space-y-5 rounded-[1.75rem] border border-line bg-card p-5 shadow-soft sm:p-7" noValidate>
            {isStart && (
              <>
                <Field label={A.shopName} hint={A.shopNameHint}>
                  <Input value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder={A.shopNamePh} maxLength={40} autoComplete="organization" required />
                </Field>
                <Field label={A.city} optional={t.common.optional}>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder={A.cityPh} maxLength={40} autoComplete="address-level2" />
                </Field>
              </>
            )}
            <Field label={A.phone} hint={isStart ? A.phoneHint : undefined}>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center font-semibold text-ink-soft">+221</span>
                <Input
                  className="tabular pl-16 text-lg font-semibold"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/[^\d +]/g, "").slice(0, 18))}
                  placeholder="77 123 45 67"
                  required
                />
              </div>
            </Field>
            <Field label={A.pin} hint={isStart ? A.pinHint : undefined}>
              <Input
                className="tabular text-center text-2xl font-semibold tracking-[0.5em]"
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                autoComplete={isStart ? "new-password" : "current-password"}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••••"
                required
              />
            </Field>

            {error && <Notice tone="error">{error}</Notice>}

            <Button type="submit" size="lg" className="w-full" busy={busy} disabled={!ready}>
              {isStart ? A.create : A.signIn}
            </Button>
          </form>

          <p className="mt-6 text-center text-ink-soft">
            {isStart ? A.haveAccount : A.noAccount}{" "}
            <Link href={isStart ? "/login" : "/start"} className="font-semibold text-ink underline underline-offset-4">
              {isStart ? A.signIn : A.create}
            </Link>
          </p>
        </main>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-line bg-sky lg:block" aria-hidden={false}>
        <div className="absolute -right-36 -top-32 size-[34rem] rounded-full border border-indigo/10" />
        <div className="absolute -bottom-48 -left-36 size-[34rem] rounded-full border border-indigo/10" />
        <div className="absolute inset-y-0 left-1/2 w-px bg-indigo/5" />
        <div className="relative flex h-full items-center justify-center p-10 xl:p-16">
          <div className="w-full max-w-[29rem]">
            <div className="mb-5 flex items-center justify-between">
              <span className="flex items-center gap-2 font-display text-xl font-semibold">
                <Mark size={26} />
                Jotna
              </span>
              <span className="rounded-full border border-line bg-card/80 px-3 py-1 text-xs font-semibold text-ink-soft">
                {isStart ? A.create : A.signIn}
              </span>
            </div>
            <div className="relative mb-5 overflow-hidden rounded-[1.75rem] bg-indigo-deep p-6 text-card shadow-block">
              <div className="absolute -top-14 -right-10 size-40 rounded-full border border-white/15" aria-hidden="true" />
              <div className="relative flex items-start justify-between gap-5">
                <div>
                  <p className="eyebrow text-card/65">{t.landing.ticket.shop}</p>
                  <p className="mt-3 font-display text-2xl font-semibold">{t.landing.ticket.item}</p>
                </div>
                <span className="rounded-full bg-white/10 px-3 py-1 text-[0.7rem] font-semibold uppercase tracking-wide">{t.landing.ticket.stamp}</span>
              </div>
              <div className="relative mt-5 flex items-end justify-between border-t border-white/20 pt-4">
                <span className="text-sm text-card/70">{t.common.total}</span>
                <span className="tabular font-display text-3xl font-semibold">{xof(t.landing.ticket.price + t.landing.ticket.delivery)}</span>
              </div>
            </div>
            <div className="rounded-[2rem] border border-line bg-card p-6 shadow-block sm:p-8">
              <h2 className="text-3xl font-semibold sm:text-4xl">{A.side.title}</h2>
              <ul className="mt-7 space-y-4">
              {A.side.points.map((p) => (
                <li key={p} className="flex gap-3 text-[1.05rem]">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-leaf text-card">
                    <IconCheck width={14} height={14} strokeWidth={3} />
                  </span>
                  {p}
                </li>
              ))}
              </ul>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
