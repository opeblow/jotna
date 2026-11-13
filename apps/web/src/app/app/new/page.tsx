"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMe } from "@/components/AppShell";
import { IconCamera, IconSpark } from "@/components/icons";
import { useErrorText, useI18n } from "@/components/i18n";
import { Ticket } from "@/components/landing/Ticket";
import { Button, buttonClass, Field, Input, MoneyInput, Notice, Textarea } from "@/components/ui";
import { api, newIdempotencyKey, type SellerOrder } from "@/lib/api";
import { xof } from "@/lib/format";
import { blobToBase64, shrinkPhoto } from "@/lib/image";

interface Draft {
  title: string;
  description: string;
  amount_xof: number | null;
  delivery_fee_xof: number | null;
}

export default function NewOrderPage() {
  const { t } = useI18n();
  const { me } = useMe();
  const errorText = useErrorText();
  const router = useRouter();
  const N = t.newOrder;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");
  const [customer, setCustomer] = useState("");
  const [windowMinutes, setWindowMinutes] = useState(720);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDone, setAiDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // One key per form: if the network drops after the server created the order, the retry returns it.
  const idempotencyKey = useRef(newIdempotencyKey());

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
  }, [photoUrl]);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const small = await shrinkPhoto(file);
      setPhoto(small);
      setPhotoUrl(URL.createObjectURL(small));
      setError(null);
    } catch {
      setError(t.errors.invalid_image!);
    }
  }

  async function askAssistant() {
    setAiBusy(true);
    setError(null);
    try {
      const image = photo ? { media_type: "image/jpeg" as const, data: await blobToBase64(photo) } : undefined;
      const draft = await api<Draft>("POST", "/ai/listing", { body: { text: note, image } });
      setTitle(draft.title);
      setDescription(draft.description);
      if (draft.amount_xof) setAmount(String(draft.amount_xof));
      if (draft.delivery_fee_xof !== null) setFee(String(draft.delivery_fee_xof));
      setAiDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setAiBusy(false);
    }
  }

  const amountN = Number(amount || 0);
  const feeN = Number(fee || 0);
  const total = amountN + feeN;
  const inRange = total >= me.features.min_order_xof && total <= me.features.max_order_xof;
  const ready = title.trim().length >= 2 && amountN > 0 && inRange;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let imageId: string | null = null;
      if (photo) imageId = (await api<{ id: string }>("POST", "/images", { raw: photo })).id;
      const order = await api<SellerOrder>("POST", "/orders", {
        headers: { "Idempotency-Key": idempotencyKey.current },
        body: {
          title: title.trim(),
          description: description.trim() || null,
          amount_xof: amountN,
          delivery_fee_xof: feeN,
          customer_label: customer.trim() || null,
          delivery_window_minutes: windowMinutes,
          image_id: imageId,
        },
      });
      router.replace(`/app/orders/${order.id}?new=1`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (!me.wallet) {
    return (
      <div className="mx-auto max-w-lg rounded-[2rem] border-2 border-ink bg-butter p-8 text-center">
        <h1 className="text-3xl font-semibold">{t.app.walletMissing.title}</h1>
        <p className="mt-2 text-ink-soft">{t.app.walletMissing.body}</p>
        <Link href="/app/wallet" className={buttonClass("primary", "md", "mt-6")}>{t.app.walletMissing.cta}</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
      <p className="eyebrow text-indigo">{t.app.nav.new}</p>
      <h1 className="text-4xl font-semibold sm:text-5xl">{N.title}</h1>
      <p className="mt-3 text-lg text-ink-soft">{N.sub}</p>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(18rem,0.7fr)]">
      <div className="min-w-0">
      {me.features.ai && (
        <section className="mb-6 rounded-[1.75rem] border border-line bg-butter p-5 shadow-soft sm:p-6">
          <h2 className="flex items-center gap-2 text-xl font-semibold sm:text-2xl">
            <IconSpark />
            {N.ai.title}
          </h2>
          <p className="mt-1 text-ink-soft">{N.ai.hint}</p>
          <Textarea className="mt-4 font-mono text-[0.95rem]" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={N.ai.ph} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button type="button" variant="indigo" size="sm" onClick={askAssistant} busy={aiBusy} disabled={!note.trim() && !photo}>
              {aiBusy ? N.ai.working : N.ai.cta}
            </Button>
            {aiDone && !aiBusy && <span className="text-sm font-medium text-leaf">{N.ai.done}</span>}
          </div>
        </section>
      )}

      <form onSubmit={submit} className="space-y-6 rounded-[1.75rem] border border-line bg-card p-5 shadow-soft sm:p-8" noValidate>
        <div>
          <span className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[0.95rem] font-semibold">{N.photo}</span>
            <span className="text-sm text-ink-faint">{t.common.optional}</span>
          </span>
          <input ref={fileRef} type="file" accept="image/*" className="sr-only" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center gap-4 rounded-2xl border-2 border-dashed border-ink/40 bg-card p-3 text-left hover:border-ink"
          >
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" className="size-20 rounded-xl border-2 border-ink object-cover" />
            ) : (
              <span className="flex size-20 items-center justify-center rounded-xl bg-sand text-ink-soft"><IconCamera width={28} height={28} /></span>
            )}
            <span>
              <span className="block font-semibold">{photoUrl ? N.changePhoto : N.addPhoto}</span>
              <span className="block text-sm text-ink-soft">{N.photoHint}</span>
            </span>
          </button>
        </div>

        <Field label={N.itemTitle}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={N.itemTitlePh} maxLength={80} required />
        </Field>
        <Field label={N.description} optional={t.common.optional}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={N.descriptionPh} maxLength={500} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={N.price}>
            <MoneyInput value={amount} onChange={setAmount} placeholder="0" required />
          </Field>
          <Field label={N.deliveryFee}>
            <MoneyInput value={fee} onChange={setFee} placeholder="0" />
          </Field>
        </div>
        {total > 0 && !inRange && <Notice tone="error">{`${t.errors.amount_out_of_range} (${xof(me.features.min_order_xof)} – ${xof(me.features.max_order_xof)})`}</Notice>}

        <Field label={N.customer} hint={N.customerHint} optional={t.common.optional}>
          <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder={N.customerPh} maxLength={60} />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[0.95rem] font-semibold">{N.window}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {N.windows.map((w) => (
              <label key={w.m} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border-2 px-3 text-center font-semibold ${windowMinutes === w.m ? "border-ink bg-sun" : "border-line bg-card hover:border-ink"}`}>
                <input type="radio" name="window" className="sr-only" checked={windowMinutes === w.m} onChange={() => setWindowMinutes(w.m)} />
                {w.l}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-sm text-ink-soft">{N.windowHint}</p>
        </fieldset>

        {error && <Notice tone="error">{error}</Notice>}

        <div className="sticky bottom-24 z-10 flex items-center justify-between gap-4 border-t border-line bg-card/95 pt-5 backdrop-blur md:static md:bg-transparent md:pt-3 md:backdrop-blur-none">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-ink-soft">{N.summary}</p>
              <p className="tabular font-display text-2xl leading-tight font-semibold">{xof(total)}</p>
            </div>
          </div>
          <Button type="submit" busy={busy} disabled={!ready}>{busy ? N.creating : N.create}</Button>
        </div>
      </form>
      </div>

      <aside className="lg:sticky lg:top-24">
        <section className="overflow-hidden rounded-[2rem] border border-line bg-sky p-5 shadow-soft sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow text-indigo">{N.summary}</p>
              <h2 className="mt-2 text-2xl font-semibold">{N.title}</h2>
            </div>
            <span className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-ink-soft">{t.common.optional}</span>
          </div>
          <div className="mt-5">
            <Ticket
              shop={me.seller.shop_name}
              title={title.trim() || N.itemTitlePh}
              note={description.trim() || N.descriptionPh}
              amount={amountN}
              delivery={feeN}
              labels={{ item: t.common.item, delivery: t.common.delivery, total: t.common.total }}
            />
          </div>
          <div className="mt-5 flex items-center justify-between rounded-2xl border border-line bg-card px-4 py-3">
            <span className="text-sm text-ink-soft">{N.window}</span>
            <span className="text-sm font-semibold">{N.windows.find((w) => w.m === windowMinutes)?.l}</span>
          </div>
        </section>
      </aside>
      </div>
    </div>
  );
}
