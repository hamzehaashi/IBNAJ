/**
 * Financial display formatting. Presentation only — never used inside calculations.
 * Conventions: negatives in parentheses, amounts in USD millions unless stated, "—" for
 * missing values (the reason is shown separately).
 */

export const DASH = "—";

const nf = (min: number, max: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
const nf0 = nf(0, 0);
const nf1 = nf(1, 1);
const nf2 = nf(2, 2);

const paren = (s: string, negative: boolean) => (negative ? `(${s})` : s);

/** USD millions with parentheses for negatives, e.g. 1234567890 → "1,234.6". */
export function millions(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const m = Math.abs(v) / 1e6;
  return paren((decimals === 0 ? nf0 : decimals === 2 ? nf2 : nf1).format(m), v < 0);
}

/** Compact currency, e.g. 2.1e12 → "$2.10T". */
export function compactUsd(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const a = Math.abs(v);
  const [d, s] = a >= 1e12 ? [1e12, "T"] : a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
  return paren(`$${nf2.format(a / d)}${s}`, v < 0);
}

export function usd(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return paren(`$${nf(decimals, decimals).format(Math.abs(v))}`, v < 0);
}

export function pct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return paren(`${nf(decimals, decimals).format(Math.abs(v) * 100)}%`, v < 0);
}

/** Signed percent for changes, e.g. "+12.3%" / "−4.0%". */
export function signedPct(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  const s = `${nf(decimals, decimals).format(Math.abs(v) * 100)}%`;
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

export function multiple(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return paren(`${nf(decimals, decimals).format(Math.abs(v))}x`, v < 0);
}

export function ratio(v: number | null | undefined, decimals = 2): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return paren(nf(decimals, decimals).format(Math.abs(v)), v < 0);
}

export function shares(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return `${nf1.format(v / 1e6)}M`;
}

export function days(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH;
  return paren(`${nf0.format(Math.abs(v))} days`, v < 0);
}

export function dateLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
