"use client";

import { Info } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx("min-w-0 rounded-lg border border-line bg-card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-[13px] font-semibold tracking-wide text-fg">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

type Tone = "neutral" | "accent" | "pos" | "neg" | "warn" | "valuation";
const toneClass: Record<Tone, string> = {
  neutral: "border-line text-fg-2",
  accent: "border-accent/40 text-accent",
  pos: "border-pos/40 text-pos",
  neg: "border-neg/40 text-neg",
  warn: "border-warn/40 text-warn",
  valuation: "border-valuation/40 text-valuation",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide", toneClass[tone])}>
      {children}
    </span>
  );
}

/** Accessible hover/focus tooltip for terminology and formulas. */
export function Tip({ text, children }: { text: ReactNode; children?: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center text-fg-2 hover:text-accent"
      >
        {children ?? <Info size={12} aria-label="More information" />}
      </button>
      {open && (
        <span role="tooltip" id={id} className="absolute left-1/2 top-full z-50 mt-1 w-72 -translate-x-1/2 rounded-md border border-line bg-bg-2 p-2.5 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-fg shadow-xl">
          {text}
        </span>
      )}
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "ghost",
  disabled,
  title,
  type = "button",
  className,
  ...rest
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "outline";
  disabled?: boolean;
  title?: string;
  type?: "button" | "submit";
  className?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  "data-testid"?: string;
}) {
  const v = {
    primary: "bg-accent text-[#0b0f17] hover:brightness-110 font-semibold",
    outline: "border border-line text-fg hover:border-accent/60",
    ghost: "text-fg-2 hover:text-fg hover:bg-bg-2",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={cx("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40", v, className)} {...rest}>
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-bg-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("rounded px-2.5 py-1 text-[12px]", value === o.value ? "bg-card text-fg shadow" : "text-fg-2 hover:text-fg")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kpi({ label, value, sub, tone, tip }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "pos" | "neg" | "valuation"; tip?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-card px-4 py-3">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-fg-2">
        {label}
        {tip && <Tip text={tip} />}
      </div>
      <div className={cx("num mt-1 truncate text-xl font-semibold", tone === "pos" && "text-pos", tone === "neg" && "text-neg", tone === "valuation" && "text-valuation")}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-fg-2">{sub}</div>}
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center">
      {icon && <div className="text-fg-2">{icon}</div>}
      <div className="font-medium text-fg">{title}</div>
      {children && <div className="max-w-lg text-[12px] text-fg-2">{children}</div>}
    </div>
  );
}

export function Alert({ tone, title, children }: { tone: "neg" | "warn" | "accent"; title: string; children?: ReactNode }) {
  const c = { neg: "border-neg/40 bg-neg/10", warn: "border-warn/40 bg-warn/10", accent: "border-accent/40 bg-accent/10" }[tone];
  return (
    <div role={tone === "neg" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-[12px]", c)}>
      <div className={cx("font-semibold", tone === "neg" ? "text-neg" : tone === "warn" ? "text-warn" : "text-accent")}>{title}</div>
      {children && <div className="mt-0.5 text-fg">{children}</div>}
    </div>
  );
}
