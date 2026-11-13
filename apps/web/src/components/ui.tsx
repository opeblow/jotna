import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import type { OrderStatus } from "@/lib/api";

// ---- Brand -------------------------------------------------------------------------------------

/** A doorway with its handle: the place where the payment is released. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="#d7ad61" stroke="#183e2d" strokeWidth="2.2" />
      <path d="M10 26V14a6 6 0 0 1 12 0v12Z" fill="#183e2d" stroke="#183e2d" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="18.6" cy="19.5" r="1.7" fill="#fffdf7" />
    </svg>
  );
}

export function Logo({ href = "/", size = "md" }: { href?: string; size?: "md" | "lg" }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2.5" aria-label="Jotna">
      <Mark size={size === "lg" ? 38 : 30} />
      <span className={`font-display font-semibold tracking-tight ${size === "lg" ? "text-3xl" : "text-2xl"}`}>Jotna</span>
    </Link>
  );
}

// ---- Buttons -----------------------------------------------------------------------------------

type Variant = "primary" | "indigo" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-[transform,box-shadow,background-color,border-color] duration-200 select-none disabled:cursor-not-allowed disabled:opacity-55";
const sizes: Record<Size, string> = {
  sm: "min-h-10 px-4 text-sm",
  md: "min-h-12 px-6 text-base",
  lg: "min-h-14 px-8 text-lg",
};
const pressable = "border border-transparent shadow-sm hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:hover:translate-y-0";
const variants: Record<Variant, string> = {
  primary: `bg-indigo-deep text-card ${pressable} hover:bg-indigo`,
  indigo: `bg-indigo text-card ${pressable} hover:bg-indigo-deep`,
  secondary: `border-line bg-card text-ink ${pressable} hover:border-ink/20`,
  ghost: "text-ink hover:bg-sand",
  danger: "text-clay-deep underline underline-offset-4 hover:bg-blush",
};

export const buttonClass = (variant: Variant = "primary", size: Size = "md", extra = "") =>
  `${base} ${sizes[size]} ${variants[variant]} ${extra}`;

export function Button({
  variant = "primary",
  size = "md",
  busy = false,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; busy?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || busy} aria-busy={busy} className={buttonClass(variant, size, className)}>
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`size-5 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---- Forms -------------------------------------------------------------------------------------

export function Field({ label, hint, error, optional, children }: { label: string; hint?: string; error?: string | null; optional?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[0.95rem] font-semibold">{label}</span>
        {optional && <span className="text-sm text-ink-faint">{optional}</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-sm font-medium text-clay-deep">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-sm text-ink-soft">{hint}</span>
      ) : null}
    </label>
  );
}

const inputClass =
  "block w-full rounded-xl border border-line bg-card px-4 text-base text-ink placeholder:text-ink-faint transition-[border-color,box-shadow] focus:border-indigo focus:ring-4 focus:ring-indigo/10 focus:outline-none";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} min-h-13 ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} py-3 ${props.className ?? ""}`} />;
}

/** A price field that shows the currency and keeps the numeric keypad on phones. */
export function MoneyInput({ value, onChange, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onChange: (v: string) => void }) {
  const display = value.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (
    <div className="relative">
      <input
        {...rest}
        inputMode="numeric"
        autoComplete="off"
        value={display}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 8))}
        className={`${inputClass} tabular min-h-13 pr-16 text-lg font-semibold`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-ink-soft">F CFA</span>
    </div>
  );
}

// ---- Feedback ----------------------------------------------------------------------------------

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "success" | "warn"; children: ReactNode }) {
  const tones = {
    info: "bg-sky border-indigo/30 text-indigo-deep",
    error: "bg-blush border-clay/40 text-clay-deep",
    success: "bg-mint border-leaf/40 text-leaf",
    warn: "bg-butter border-sun text-ink",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-2xl border-2 px-4 py-3 text-[0.95rem] font-medium ${tones[tone]}`}>
      {children}
    </div>
  );
}

const statusTone: Record<OrderStatus, string> = {
  open: "bg-sand text-ink-soft",
  awaiting_payment: "bg-butter text-ink",
  funded: "bg-sky text-indigo-deep",
  settling: "bg-sky text-indigo-deep",
  completed: "bg-mint text-leaf",
  refunding: "bg-blush text-clay-deep",
  refunded: "bg-blush text-clay-deep",
  cancelled: "bg-sand text-ink-faint",
};

export function StatusBadge({ status, label }: { status: OrderStatus; label: string }) {
  const live = status === "awaiting_payment" || status === "settling" || status === "refunding";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8rem] font-semibold whitespace-nowrap ${statusTone[status]}`}>
      <span className={`size-1.5 rounded-full bg-current ${live ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

/** A rubber stamp, slightly crooked, the way a market receipt is stamped. */
export function Stamp({ children, tone = "clay", rotate = -7, animate = false, className = "" }: { children: ReactNode; tone?: "clay" | "leaf" | "indigo"; rotate?: number; animate?: boolean; className?: string }) {
  const tones = { clay: "border-clay text-clay", leaf: "border-leaf text-leaf", indigo: "border-indigo text-indigo" };
  return (
    <span
      style={{ ["--stamp-rotate" as string]: `${rotate}deg`, transform: `rotate(${rotate}deg)` }}
      className={`inline-block rounded-lg border-[3px] border-double px-3 py-1.5 font-display text-sm font-bold tracking-[0.12em] uppercase ${tones[tone]} ${animate ? "animate-stamp" : ""} ${className}`}
    >
      {children}
    </span>
  );
}

export function Stars({ value, size = 18 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
          <path
            d="M10 1.8l2.5 5.2 5.7.8-4.1 4 1 5.7L10 14.8l-5.1 2.7 1-5.7-4.1-4 5.7-.8z"
            fill={n <= Math.round(value) ? "#f2b632" : "#f1e7d0"}
            stroke="#211b14"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </span>
  );
}
