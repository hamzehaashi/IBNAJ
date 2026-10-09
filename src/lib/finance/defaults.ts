/**
 * Initial model assumptions derived from historical data. Every default records where it
 * came from so the UI can distinguish historical derivations from illustrative analyst
 * assumptions. None of these are recommendations.
 */
import type { LineId, StatementSet } from "@/lib/sec/statements";
import { cagr } from "./forecast";
import type { ForecastAssumptions, ModelBase, ValuationAssumptions } from "./types";
import { marketDebtWeight } from "./wacc";

export type AssumptionSourceKind = "historical" | "reported" | "market" | "illustrative";

export interface AssumptionSource {
  kind: AssumptionSourceKind;
  description: string;
}

export interface ModelDefaults {
  base: ModelBase;
  forecast: ForecastAssumptions;
  valuation: ValuationAssumptions;
  sources: Record<string, AssumptionSource>;
  /** Fiscal period whose balance sheet feeds the equity bridge. */
  bridgeAsOf: string;
}

export interface DefaultsInput {
  annual: StatementSet;
  /** Optional quarterly set: a balance sheet newer than the last annual one is preferred for the bridge. */
  quarterly?: StatementSet;
  marketPrice: number | null;
  /** ISO date of the valuation. */
  valuationDate: string;
  horizon?: number;
}

/** Illustrative market assumptions — NOT observed market data. Replace with sourced values. */
export const ILLUSTRATIVE = {
  riskFreeRate: 0.0425,
  equityRiskPremium: 0.05,
  beta: 1.0,
  preTaxCostOfDebt: 0.055,
  marginalTaxRate: 0.21,
  debtWeight: 0.2,
  terminalGrowth: 0.025,
  exitMultiple: 12,
} as const;

const LOOKBACK = 3;

export class InsufficientDataError extends Error {}

export function deriveModelDefaults(input: DefaultsInput): ModelDefaults {
  const { annual } = input;
  const horizon = input.horizon ?? 5;
  const sources: Record<string, AssumptionSource> = {};
  const v = (line: LineId, i: number) => annual.lines[line]?.[i]?.value ?? null;

  // Base year = latest annual period with reported revenue.
  let b = annual.periods.length - 1;
  while (b >= 0 && v("revenue", b) === null) b--;
  if (b < 0) throw new InsufficientDataError("No annual revenue available; a forecast cannot be initialized.");
  const basePeriod = annual.periods[b]!;
  const baseRevenue = v("revenue", b)!;
  const window = Array.from({ length: Math.min(LOOKBACK, b + 1) }, (_, k) => b - k).reverse();
  const windowLabel = `${annual.periods[window[0]!]!.label}–${basePeriod.label}`;

  const avgRatio = (num: LineId, den: LineId, filter?: (n: number, d: number) => boolean) => {
    const xs = window
      .map((i) => [v(num, i), v(den, i)] as const)
      .filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null && p[1] !== 0 && (!filter || filter(p[0], p[1])))
      .map(([n, d]) => n / d);
    return xs.length ? { value: xs.reduce((s, x) => s + x, 0) / xs.length, n: xs.length } : null;
  };
  const fill = (x: number) => Array.from({ length: horizon }, () => x);

  // Revenue growth: CAGR over the look-back window.
  const startIdx = window[0]!;
  const growthYears = b - startIdx;
  const g = growthYears > 0 ? cagr(v("revenue", startIdx), baseRevenue, growthYears) : null;
  const revenueGrowth = g ?? 0.03;
  sources.revenueGrowth = g !== null
    ? { kind: "historical", description: `${growthYears}-year revenue CAGR (${windowLabel})` }
    : { kind: "illustrative", description: "Insufficient revenue history; 3.0% illustrative placeholder" };

  const opm = avgRatio("operatingIncome", "revenue");
  sources.operatingMargin = opm
    ? { kind: "historical", description: `Average operating margin, ${opm.n} yrs (${windowLabel})` }
    : { kind: "illustrative", description: "Operating income unavailable; 10% illustrative placeholder" };

  const gm = avgRatio("grossProfit", "revenue");
  const sga = avgRatio("sga", "revenue");
  const rnd = avgRatio("rnd", "revenue");
  sources.grossMargin = gm ? { kind: "historical", description: `Average gross margin (${windowLabel})` } : { kind: "illustrative", description: "Gross profit not available; cost build-up method not supported by history" };
  sources.sgaPct = sga ? { kind: "historical", description: `Average SG&A % of revenue (${windowLabel})` } : { kind: "illustrative", description: "SG&A not reported; 0% placeholder" };
  sources.rndPct = rnd ? { kind: "historical", description: `Average R&D % of revenue (${windowLabel})` } : { kind: "illustrative", description: "R&D not reported; 0% assumed in cost build-up" };

  const tax = avgRatio("incomeTax", "pretaxIncome", (n, d) => d > 0 && n / d >= 0 && n / d <= 0.5);
  sources.taxRate = tax
    ? { kind: "historical", description: `Average effective tax rate (${windowLabel})` }
    : { kind: "illustrative", description: "Effective rate not derivable; 21% US federal statutory rate" };

  const da = avgRatio("depreciationAmortization", "revenue");
  sources.daPct = da ? { kind: "historical", description: `Average D&A % of revenue, ${da.n} yrs with data (${windowLabel})` } : { kind: "illustrative", description: "D&A not reported; 0% placeholder" };
  const capex = avgRatio("capex", "revenue");
  sources.capexPct = capex ? { kind: "historical", description: `Average capex % of revenue (${windowLabel})` } : { kind: "illustrative", description: "Capex not reported; 0% placeholder" };

  // Operating NWC = Receivables + Inventory − Accounts payable (components that are reported).
  const nwcParts: [LineId, 1 | -1][] = [["receivables", 1], ["inventory", 1], ["accountsPayable", -1]];
  const present = nwcParts.filter(([l]) => v(l, b) !== null);
  const baseNwc = present.length ? present.reduce((s, [l, sign]) => s + sign * v(l, b)!, 0) : null;
  const absent = nwcParts.filter(([l]) => v(l, b) === null).map(([l]) => l);
  const nwcPct = baseNwc !== null ? baseNwc / baseRevenue : 0;
  sources.nwcPct = baseNwc !== null
    ? { kind: "historical", description: `${basePeriod.label} operating NWC (Receivables + Inventory − Payables) % of revenue${absent.length ? `; not reported and excluded: ${absent.join(", ")}` : ""}` }
    : { kind: "illustrative", description: "Working-capital components not reported; 0% placeholder" };

  const forecast: ForecastAssumptions = {
    horizon,
    revenueGrowth: fill(revenueGrowth),
    marginMethod: "operatingMargin",
    operatingMargin: fill(opm?.value ?? 0.1),
    grossMargin: fill(gm?.value ?? opm?.value ?? 0.1),
    sgaPct: fill(sga?.value ?? 0),
    rndPct: fill(rnd?.value ?? 0),
    taxRate: fill(tax?.value ?? ILLUSTRATIVE.marginalTaxRate),
    daPct: fill(da?.value ?? 0),
    capexPct: fill(capex?.value ?? 0),
    nwcPct: fill(nwcPct),
  };

  // ---------------- Equity bridge from the most recent balance sheet.
  let bs: { set: StatementSet; i: number } = { set: annual, i: b };
  const q = input.quarterly;
  if (q && q.periods.length) {
    const qi = q.periods.length - 1;
    if (q.periods[qi]!.end > basePeriod.end && q.lines.totalAssets[qi]?.value !== null) bs = { set: q, i: qi };
  }
  const bsPeriod = bs.set.periods[bs.i]!;
  const bv = (line: LineId) => bs.set.lines[line]?.[bs.i]?.value ?? null;
  const bridgeItem = (key: string, line: LineId | null, label: string) => {
    const val = line ? bv(line) : null;
    sources[`bridge.${key}`] = val !== null
      ? { kind: "reported", description: `${label}, balance sheet ${bsPeriod.label} (${bsPeriod.end})` }
      : { kind: "illustrative", description: `${label} not reported in ${bsPeriod.label}; 0 assumed — edit if applicable` };
    return val ?? 0;
  };
  const debt = bridgeItem("debt", "totalDebt", "Total debt");
  const bridge = {
    cash: bridgeItem("cash", "cash", "Cash & equivalents"),
    shortTermInvestments: bridgeItem("shortTermInvestments", "shortTermInvestments", "Short-term investments"),
    debt,
    minorityInterest: bridgeItem("minorityInterest", "minorityInterest", "Noncontrolling interest"),
    preferredEquity: bridgeItem("preferredEquity", null, "Preferred equity (not yet mapped)"),
    nonOperatingAssets: bridgeItem("nonOperatingAssets", null, "Non-operating assets (analyst input)"),
  };

  // ---------------- Shares: latest diluted weighted average (treasury-stock dilution not recomputed).
  const shares = v("dilutedShares", b) ?? v("sharesOutstanding", b);
  if (shares === null) throw new InsufficientDataError("No share count available; per-share value cannot be computed.");
  sources.dilutedShares = v("dilutedShares", b) !== null
    ? { kind: "reported", description: `Diluted weighted-average shares, ${basePeriod.label}` }
    : { kind: "reported", description: `Cover-page shares outstanding after ${basePeriod.label} (basic count)` };

  // ---------------- WACC inputs.
  const avgDebt = window.length >= 2 ? avgOf([v("totalDebt", b), v("totalDebt", b - 1)]) : v("totalDebt", b);
  const interest = v("interestExpense", b);
  const impliedKd = interest !== null && avgDebt !== null && avgDebt > 0 ? interest / avgDebt : null;
  const kdOk = impliedKd !== null && impliedKd >= 0.005 && impliedKd <= 0.15;
  sources.preTaxCostOfDebt = kdOk
    ? { kind: "historical", description: `${basePeriod.label} interest expense ÷ average total debt` }
    : { kind: "illustrative", description: "Illustrative 5.5% (implied rate unavailable or implausible)" };
  const marketCap = input.marketPrice !== null ? input.marketPrice * shares : null;
  const wd = marketDebtWeight(marketCap, debt > 0 ? debt : 0);
  sources.debtWeight = wd !== null
    ? { kind: "market", description: "Debt ÷ (Debt + market capitalization at reference price)" }
    : { kind: "illustrative", description: "Illustrative 20% target debt weight" };
  sources.riskFreeRate = { kind: "illustrative", description: "Illustrative 4.25% — replace with a sourced Treasury yield" };
  sources.beta = { kind: "illustrative", description: "Illustrative 1.00 — no licensed beta source configured" };
  sources.equityRiskPremium = { kind: "illustrative", description: "Illustrative 5.0% equity risk premium" };
  sources.marginalTaxRate = { kind: "illustrative", description: "21% US federal statutory rate" };
  sources.terminalGrowth = { kind: "illustrative", description: "Illustrative 2.5% long-run growth" };
  sources.exitMultiple = { kind: "illustrative", description: "Illustrative 12.0x EV/EBITDA — not derived from peers" };
  sources.referencePrice = input.marketPrice !== null
    ? { kind: "market", description: "Reference price from market data snapshot" }
    : { kind: "illustrative", description: "No market price available — enter a reference price" };

  // ---------------- Stub period: share of forecast year 1 remaining after the valuation date.
  const fy1End = addYears(basePeriod.end, 1);
  const remaining = (Date.parse(fy1End) - Date.parse(input.valuationDate)) / 86_400_000;
  const stubFraction = Math.min(1, Math.max(0, remaining / 365));
  sources.stubFraction = { kind: "historical", description: `Valuation date ${input.valuationDate}; forecast year 1 ends ≈ ${fy1End}` };

  const valuation: ValuationAssumptions = {
    wacc: {
      riskFreeRate: ILLUSTRATIVE.riskFreeRate,
      beta: ILLUSTRATIVE.beta,
      equityRiskPremium: ILLUSTRATIVE.equityRiskPremium,
      preTaxCostOfDebt: kdOk ? impliedKd! : ILLUSTRATIVE.preTaxCostOfDebt,
      marginalTaxRate: ILLUSTRATIVE.marginalTaxRate,
      debtWeight: wd ?? ILLUSTRATIVE.debtWeight,
    },
    waccOverride: null,
    terminalMethod: "perpetuity",
    terminalGrowth: ILLUSTRATIVE.terminalGrowth,
    exitMultiple: ILLUSTRATIVE.exitMultiple,
    midYearConvention: true,
    stubFraction,
    bridge,
    dilutedShares: shares,
    referencePrice: input.marketPrice,
  };

  return {
    base: { baseYear: basePeriod.fiscalYear, baseRevenue, baseNwc },
    forecast,
    valuation,
    sources,
    bridgeAsOf: `${bsPeriod.label} (${bsPeriod.end})`,
  };
}

function avgOf(xs: (number | null)[]): number | null {
  const ok = xs.filter((x): x is number => x !== null);
  return ok.length === xs.length && ok.length > 0 ? ok.reduce((s, x) => s + x, 0) / ok.length : null;
}

function addYears(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return d.toISOString().slice(0, 10);
}
