/**
 * Financial ratio engine. Every ratio has a formula string and returns null with a reason
 * when an input is unavailable. Averages of balance-sheet items require the prior period;
 * the first period of a series is therefore unavailable for return/turnover ratios.
 */
import type { LineId, StatementSet } from "@/lib/sec/statements";

export type RatioFormat = "pct" | "multiple" | "days" | "currency" | "ratio";
export type RatioCategory = "Profitability" | "Liquidity" | "Leverage" | "Efficiency" | "Growth";

export interface RatioPoint {
  value: number | null;
  reason?: string;
}

export interface RatioSeries {
  id: string;
  label: string;
  category: RatioCategory;
  formula: string;
  format: RatioFormat;
  points: RatioPoint[];
}

type Get = (line: LineId, i: number) => number | null;
type Avg = (line: LineId, i: number) => number | null;

interface RatioDef {
  id: string;
  label: string;
  category: RatioCategory;
  formula: string;
  format: RatioFormat;
  /** Lines this ratio reads (used to name missing inputs). */
  inputs: LineId[];
  compute: (get: Get, avg: Avg, i: number) => number | null;
}

const div = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b);
const sub = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
const growthOf = (cur: number | null, prev: number | null) => (cur === null || prev === null || prev <= 0 ? null : cur / prev - 1);

const DEFS: RatioDef[] = [
  // Profitability
  { id: "grossMargin", label: "Gross margin", category: "Profitability", formula: "Gross profit ÷ Revenue", format: "pct", inputs: ["grossProfit", "revenue"], compute: (g, _a, i) => div(g("grossProfit", i), g("revenue", i)) },
  { id: "ebitdaMargin", label: "EBITDA margin", category: "Profitability", formula: "EBITDA ÷ Revenue", format: "pct", inputs: ["ebitda", "revenue"], compute: (g, _a, i) => div(g("ebitda", i), g("revenue", i)) },
  { id: "operatingMargin", label: "Operating margin", category: "Profitability", formula: "Operating income ÷ Revenue", format: "pct", inputs: ["operatingIncome", "revenue"], compute: (g, _a, i) => div(g("operatingIncome", i), g("revenue", i)) },
  { id: "netMargin", label: "Net profit margin", category: "Profitability", formula: "Net income ÷ Revenue", format: "pct", inputs: ["netIncome", "revenue"], compute: (g, _a, i) => div(g("netIncome", i), g("revenue", i)) },
  { id: "roe", label: "Return on equity", category: "Profitability", formula: "Net income ÷ Average shareholders' equity", format: "pct", inputs: ["netIncome", "totalEquity"], compute: (g, a, i) => div(g("netIncome", i), a("totalEquity", i)) },
  { id: "roa", label: "Return on assets", category: "Profitability", formula: "Net income ÷ Average total assets", format: "pct", inputs: ["netIncome", "totalAssets"], compute: (g, a, i) => div(g("netIncome", i), a("totalAssets", i)) },
  {
    id: "roic", label: "Return on invested capital", category: "Profitability",
    formula: "EBIT × (1 − effective tax rate) ÷ Average (Total debt + Equity − Cash)", format: "pct",
    inputs: ["operatingIncome", "incomeTax", "pretaxIncome", "totalDebt", "totalEquity", "cash"],
    compute: (g, _a, i) => {
      if (i === 0) return null;
      const t = div(g("incomeTax", i), g("pretaxIncome", i));
      const ebit = g("operatingIncome", i);
      if (t === null || ebit === null) return null;
      const ic = (k: number) => {
        const d = g("totalDebt", k), e = g("totalEquity", k), c = g("cash", k);
        return d === null || e === null || c === null ? null : d + e - c;
      };
      const cur = ic(i), prev = ic(i - 1);
      if (cur === null || prev === null) return null;
      return div(ebit * (1 - t), (cur + prev) / 2);
    },
  },
  // Liquidity
  { id: "currentRatio", label: "Current ratio", category: "Liquidity", formula: "Current assets ÷ Current liabilities", format: "ratio", inputs: ["totalCurrentAssets", "totalCurrentLiabilities"], compute: (g, _a, i) => div(g("totalCurrentAssets", i), g("totalCurrentLiabilities", i)) },
  {
    id: "quickRatio", label: "Quick ratio", category: "Liquidity", formula: "(Cash + Short-term investments + Receivables) ÷ Current liabilities", format: "ratio",
    inputs: ["cash", "receivables", "totalCurrentLiabilities"],
    compute: (g, _a, i) => {
      const c = g("cash", i), r = g("receivables", i);
      return c === null || r === null ? null : div(c + (g("shortTermInvestments", i) ?? 0) + r, g("totalCurrentLiabilities", i));
    },
  },
  {
    id: "cashRatio", label: "Cash ratio", category: "Liquidity", formula: "(Cash + Short-term investments) ÷ Current liabilities", format: "ratio",
    inputs: ["cash", "totalCurrentLiabilities"],
    compute: (g, _a, i) => {
      const c = g("cash", i);
      return c === null ? null : div(c + (g("shortTermInvestments", i) ?? 0), g("totalCurrentLiabilities", i));
    },
  },
  { id: "workingCapital", label: "Working capital", category: "Liquidity", formula: "Current assets − Current liabilities", format: "currency", inputs: ["totalCurrentAssets", "totalCurrentLiabilities"], compute: (g, _a, i) => sub(g("totalCurrentAssets", i), g("totalCurrentLiabilities", i)) },
  // Leverage
  { id: "debtToEquity", label: "Debt-to-equity", category: "Leverage", formula: "Total debt ÷ Shareholders' equity", format: "ratio", inputs: ["totalDebt", "totalEquity"], compute: (g, _a, i) => div(g("totalDebt", i), g("totalEquity", i)) },
  { id: "netDebt", label: "Net debt", category: "Leverage", formula: "Total debt − Cash − Short-term investments", format: "currency", inputs: ["netDebt"], compute: (g, _a, i) => g("netDebt", i) },
  { id: "netDebtToEbitda", label: "Net debt / EBITDA", category: "Leverage", formula: "Net debt ÷ EBITDA", format: "multiple", inputs: ["netDebt", "ebitda"], compute: (g, _a, i) => div(g("netDebt", i), g("ebitda", i)) },
  { id: "interestCoverage", label: "Interest coverage", category: "Leverage", formula: "Operating income ÷ Interest expense", format: "multiple", inputs: ["operatingIncome", "interestExpense"], compute: (g, _a, i) => div(g("operatingIncome", i), g("interestExpense", i)) },
  // Efficiency
  { id: "assetTurnover", label: "Asset turnover", category: "Efficiency", formula: "Revenue ÷ Average total assets", format: "ratio", inputs: ["revenue", "totalAssets"], compute: (g, a, i) => div(g("revenue", i), a("totalAssets", i)) },
  { id: "receivablesTurnover", label: "Receivables turnover", category: "Efficiency", formula: "Revenue ÷ Average receivables", format: "ratio", inputs: ["revenue", "receivables"], compute: (g, a, i) => div(g("revenue", i), a("receivables", i)) },
  { id: "inventoryTurnover", label: "Inventory turnover", category: "Efficiency", formula: "Cost of revenue ÷ Average inventory", format: "ratio", inputs: ["costOfRevenue", "inventory"], compute: (g, a, i) => div(g("costOfRevenue", i), a("inventory", i)) },
  {
    id: "cashConversionCycle", label: "Cash conversion cycle", category: "Efficiency", formula: "DSO + DIO − DPO (365-day basis, average balances)", format: "days",
    inputs: ["revenue", "receivables", "costOfRevenue", "inventory", "accountsPayable"],
    compute: (g, a, i) => {
      const dso = div(a("receivables", i), g("revenue", i));
      const dio = div(a("inventory", i), g("costOfRevenue", i));
      const dpo = div(a("accountsPayable", i), g("costOfRevenue", i));
      return dso === null || dio === null || dpo === null ? null : (dso + dio - dpo) * 365;
    },
  },
  // Growth
  { id: "revenueGrowth", label: "Revenue growth", category: "Growth", formula: "Revenue ÷ Prior-period revenue − 1", format: "pct", inputs: ["revenue"], compute: (g, _a, i) => (i === 0 ? null : growthOf(g("revenue", i), g("revenue", i - 1))) },
  { id: "ebitdaGrowth", label: "EBITDA growth", category: "Growth", formula: "EBITDA ÷ Prior-period EBITDA − 1", format: "pct", inputs: ["ebitda"], compute: (g, _a, i) => (i === 0 ? null : growthOf(g("ebitda", i), g("ebitda", i - 1))) },
  { id: "epsGrowth", label: "EPS growth", category: "Growth", formula: "Diluted EPS ÷ Prior-period diluted EPS − 1", format: "pct", inputs: ["epsDiluted"], compute: (g, _a, i) => (i === 0 ? null : growthOf(g("epsDiluted", i), g("epsDiluted", i - 1))) },
  { id: "fcfGrowth", label: "Free cash flow growth", category: "Growth", formula: "FCF ÷ Prior-period FCF − 1", format: "pct", inputs: ["freeCashFlow"], compute: (g, _a, i) => (i === 0 ? null : growthOf(g("freeCashFlow", i), g("freeCashFlow", i - 1))) },
];

export function computeRatios(set: StatementSet): RatioSeries[] {
  const get: Get = (line, i) => set.lines[line]?.[i]?.value ?? null;
  const avg: Avg = (line, i) => {
    if (i === 0) return null;
    const a = get(line, i), b = get(line, i - 1);
    return a === null || b === null ? null : (a + b) / 2;
  };
  return DEFS.map((d) => ({
    id: d.id,
    label: d.label,
    category: d.category,
    formula: d.formula,
    format: d.format,
    points: set.periods.map((p, i) => {
      const value = d.compute(get, avg, i);
      if (value !== null && Number.isFinite(value)) return { value };
      const missing = d.inputs.filter((l) => get(l, i) === null);
      const needsPrior = /Average|Prior/.test(d.formula) && i === 0;
      const reason = missing.length
        ? `Unavailable: ${missing.join(", ")} not available for ${p.label}.`
        : needsPrior
          ? "Unavailable: requires the prior period."
          : "Unavailable: undefined for these inputs (e.g. zero or negative denominator).";
      return { value: null, reason };
    }),
  }));
}

export const RATIO_CATEGORIES: RatioCategory[] = ["Profitability", "Liquidity", "Leverage", "Efficiency", "Growth"];
