import type { ForecastAssumptions, ForecastYear, ModelBase } from "./types";

export const MIN_HORIZON = 1;
export const MAX_HORIZON = 10;

/** Human-readable formulas for every forecast line (shown in audit tooltips). */
export const FORECAST_FORMULAS: Record<string, string> = {
  revenue: "Prior-year revenue × (1 + revenue growth)",
  grossProfit: "Revenue × gross margin (cost build-up method only)",
  sga: "Revenue × SG&A % of revenue (cost build-up method only)",
  rnd: "Revenue × R&D % of revenue (cost build-up method only)",
  ebit: "Operating-margin method: Revenue × operating margin. Cost build-up: Gross profit − SG&A − R&D",
  da: "Revenue × D&A % of revenue",
  ebitda: "EBIT + D&A",
  taxes: "EBIT × tax rate when EBIT > 0; zero otherwise (loss carryforwards not modeled)",
  nopat: "EBIT − taxes",
  capex: "Revenue × capex % of revenue",
  nwc: "Revenue × operating NWC % of revenue",
  deltaNwc: "NWC − prior-year NWC (year 1 uses the historical base-year NWC)",
  fcff: "NOPAT + D&A − Capex − ΔNWC",
};

export function validateForecastAssumptions(base: ModelBase, a: ForecastAssumptions): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(a.horizon) || a.horizon < MIN_HORIZON || a.horizon > MAX_HORIZON) {
    errors.push(`Forecast horizon must be a whole number of years between ${MIN_HORIZON} and ${MAX_HORIZON}.`);
    return errors;
  }
  if (!Number.isFinite(base.baseRevenue) || base.baseRevenue <= 0) errors.push("Base-year revenue must be positive to build a forecast.");
  const arrays: (keyof ForecastAssumptions)[] = ["revenueGrowth", "taxRate", "daPct", "capexPct", "nwcPct"];
  arrays.push(...(a.marginMethod === "operatingMargin" ? (["operatingMargin"] as const) : (["grossMargin", "sgaPct", "rndPct"] as const)));
  for (const key of arrays) {
    const arr = a[key] as number[];
    if (arr.length < a.horizon) errors.push(`Assumption "${key}" has ${arr.length} years; ${a.horizon} required.`);
    else if (arr.slice(0, a.horizon).some((v) => !Number.isFinite(v))) errors.push(`Assumption "${key}" contains a non-numeric value.`);
  }
  if (a.revenueGrowth.slice(0, a.horizon).some((g) => g <= -1)) errors.push("Revenue growth must be greater than −100%.");
  if (a.taxRate.slice(0, a.horizon).some((t) => t < 0 || t >= 1)) errors.push("Tax rate must be between 0% and 100%.");
  return errors;
}

/** Project the operating forecast. Caller must validate first. */
export function projectForecast(base: ModelBase, a: ForecastAssumptions): ForecastYear[] {
  const years: ForecastYear[] = [];
  let prevRevenue = base.baseRevenue;
  let prevNwc: number | null = base.baseNwc;
  for (let i = 0; i < a.horizon; i++) {
    const growth = a.revenueGrowth[i]!;
    const revenue = prevRevenue * (1 + growth);
    let grossProfit: number | null = null;
    let sga: number | null = null;
    let rnd: number | null = null;
    let ebit: number;
    if (a.marginMethod === "costBuildUp") {
      grossProfit = revenue * a.grossMargin[i]!;
      sga = revenue * a.sgaPct[i]!;
      rnd = revenue * a.rndPct[i]!;
      ebit = grossProfit - sga - rnd;
    } else {
      ebit = revenue * a.operatingMargin[i]!;
    }
    const da = revenue * a.daPct[i]!;
    const taxRate = a.taxRate[i]!;
    const taxes = ebit > 0 ? ebit * taxRate : 0;
    const nopat = ebit - taxes;
    const capex = revenue * a.capexPct[i]!;
    const nwc = revenue * a.nwcPct[i]!;
    // Without a historical base NWC, assume the base year carried the same NWC intensity.
    const priorNwc = prevNwc ?? prevRevenue * a.nwcPct[i]!;
    const deltaNwc = nwc - priorNwc;
    const fcff = nopat + da - capex - deltaNwc;
    years.push({
      index: i,
      fiscalYear: base.baseYear + i + 1,
      label: `FY${base.baseYear + i + 1}E`,
      revenue,
      revenueGrowth: growth,
      grossProfit,
      sga,
      rnd,
      ebit,
      ebitMargin: ebit / revenue,
      da,
      ebitda: ebit + da,
      ebitdaMargin: (ebit + da) / revenue,
      taxRate,
      taxes,
      nopat,
      capex,
      nwc,
      deltaNwc,
      fcff,
    });
    prevRevenue = revenue;
    prevNwc = nwc;
  }
  return years;
}

/** Resize every per-year array to `horizon`, extending with each array's last value. */
export function resizeAssumptions(a: ForecastAssumptions, horizon: number): ForecastAssumptions {
  const fit = (arr: number[]) => Array.from({ length: horizon }, (_, i) => arr[Math.min(i, arr.length - 1)] ?? 0);
  return {
    ...a,
    horizon,
    revenueGrowth: fit(a.revenueGrowth),
    operatingMargin: fit(a.operatingMargin),
    grossMargin: fit(a.grossMargin),
    sgaPct: fit(a.sgaPct),
    rndPct: fit(a.rndPct),
    taxRate: fit(a.taxRate),
    daPct: fit(a.daPct),
    capexPct: fit(a.capexPct),
    nwcPct: fit(a.nwcPct),
  };
}

export type PerYearKey = "revenueGrowth" | "operatingMargin" | "grossMargin" | "sgaPct" | "rndPct" | "taxRate" | "daPct" | "capexPct" | "nwcPct";

/** Copy year `from`'s value of one assumption to every later year. */
export function copyForward(a: ForecastAssumptions, key: PerYearKey, from: number): ForecastAssumptions {
  const v = a[key][from];
  if (v === undefined) return a;
  return { ...a, [key]: a[key].map((x, i) => (i > from ? v : x)) };
}

/** Compound annual growth rate; null when undefined (non-positive endpoints or n ≤ 0). */
export function cagr(start: number | null, end: number | null, years: number): number | null {
  if (start === null || end === null || start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}
