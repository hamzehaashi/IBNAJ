"use client";

import { useState } from "react";
import { cx } from "@/components/ui/primitives";

/**
 * Editable numeric cell. Displays `value × scale` and commits `parsed ÷ scale` on Enter/blur.
 * Escape reverts. Invalid input is flagged and never committed.
 */
export function NumberCell({
  value,
  onCommit,
  scale = 100,
  decimals = 1,
  suffix = "%",
  label,
  min,
  max,
  disabled,
  className,
  testId,
}: {
  value: number;
  onCommit: (v: number) => void;
  scale?: number;
  decimals?: number;
  suffix?: string;
  label: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  const display = Number.isFinite(value) ? (value * scale).toFixed(decimals) : "";
  const [draft, setDraft] = useState(display);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const parsed = Number(draft.replace(/[%,x\s]/g, ""));
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setError("Enter a number");
      return false;
    }
    const v = parsed / scale;
    if ((min !== undefined && v < min) || (max !== undefined && v > max)) {
      setError(`Must be between ${min !== undefined ? (min * scale).toFixed(decimals) : "−∞"} and ${max !== undefined ? (max * scale).toFixed(decimals) : "∞"}`);
      return false;
    }
    setError(null);
    if (Math.abs(v - value) > 1e-12) onCommit(v);
    return true;
  };

  return (
    <span className={cx("relative inline-flex items-center", className)}>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={!!error}
        title={error ?? label}
        data-testid={testId}
        disabled={disabled}
        value={focused ? draft : display}
        onFocus={(e) => {
          setFocused(true);
          setDraft(display);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!commit()) setDraft(display);
          setFocused(false);
          setTimeout(() => setError(null), 2500);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (commit()) (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(display);
            setError(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cx(
          "num w-full rounded border bg-input px-1.5 py-0.5 text-right text-input-fg outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50",
          error ? "border-neg" : "border-accent/25",
        )}
      />
      {suffix && <span className="pointer-events-none ml-0.5 text-[10px] text-fg-2">{suffix}</span>}
      {error && (
        <span role="alert" className="absolute left-0 top-full z-20 mt-0.5 whitespace-nowrap rounded bg-neg px-1.5 py-0.5 text-[10px] text-white">
          {error}
        </span>
      )}
    </span>
  );
}

/** Slider + numeric input pair for valuation drivers. */
export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  scale = 100,
  decimals = 1,
  suffix = "%",
  hint,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  scale?: number;
  decimals?: number;
  suffix?: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[12px] text-fg-2" htmlFor={testId}>
          {label}
        </label>
        <NumberCell value={value} onCommit={onChange} scale={scale} decimals={decimals} suffix={suffix} label={label} className="w-24" testId={testId ? `${testId}-input` : undefined} />
      </div>
      <input
        id={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? Math.min(Math.max(value, min), max) : min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-label={`${label} slider`}
        data-testid={testId}
      />
      {hint && <div className="text-[10.5px] text-fg-2">{hint}</div>}
    </div>
  );
}
