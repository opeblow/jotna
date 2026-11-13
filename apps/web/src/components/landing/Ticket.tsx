import type { ReactNode } from "react";
import { Mark } from "@/components/ui";
import { xof } from "@/lib/format";

/**
 * The order as a paper ticket: the one object every screen of Jotna is built around.
 * Used on the landing page as an illustration and on the buyer page as the real thing.
 */
export function Ticket({
  shop,
  title,
  note,
  amount,
  delivery,
  labels,
  children,
  image,
  className = "",
}: {
  shop: string;
  title: string;
  note?: string | null;
  amount: number;
  delivery: number;
  labels: { item: string; delivery: string; total: string };
  children?: ReactNode;
  image?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <div className="rounded-3xl border border-line bg-card px-5 pt-5 pb-7 shadow-soft sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2">
            <Mark size={22} />
            <span className="truncate text-sm font-semibold">{shop}</span>
          </span>
          <span className="eyebrow text-ink-faint">Jotna</span>
        </div>

        {image}

        <h3 className="mt-4 text-[1.55rem] leading-[1.08] font-semibold sm:text-[1.7rem]">{title}</h3>
        {note && <p className="mt-1.5 text-[0.95rem] text-ink-soft">{note}</p>}

        <div className="dash-rule my-4" />
        <dl className="tabular space-y-1.5 text-[0.95rem]">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-soft">{labels.item}</dt>
            <dd className="font-medium">{xof(amount)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-soft">{labels.delivery}</dt>
            <dd className="font-medium">{xof(delivery)}</dd>
          </div>
        </dl>
        <div className="dash-rule my-4" />
        <div className="flex items-end justify-between gap-4">
          <span className="eyebrow text-ink-soft">{labels.total}</span>
          <span className="tabular font-display text-4xl leading-none font-semibold">{xof(amount + delivery)}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
