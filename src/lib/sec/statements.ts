/**
 * Statement assembly: normalized reported series + clearly marked calculated lines.
 * Calculated lines carry status "calculated" and a formula; inputs that are missing make
 * the calculation unavailable rather than silently treating them as zero.
 */
import type { MetricId } from "./concepts";
import { normalizeCompanyFacts, type Cell, type FiscalPeriod, type NormalizeOptions } from "./xbrl";
import type { CompanyFactsJson } from "./types";

export type CalculatedLineId = "ebitda" | "freeCashFlow" | "totalDebt" | "netDebt" | "otherOperatingCashFlow";
export type LineId = MetricId | CalculatedLineId;

export interface StatementSet {
  frequency: "annual" | "quarterly";
  periods: FiscalPeriod[];
  lines: Record<LineId, Cell[]>;
}

type Term = { line: LineId; sign: 1 | -1; optional?: boolean };

/** Combine cells term-by-term. Missing required inputs → status "unavailable". */
export function combine(lines: Partial<Record<LineId, Cell[]>>, terms: Term[], i: number, formula: string, labels: Partial<Record<LineId, string>> = {}): Cell {
  let total = 0;
  const missing: string[] = [];
  const omitted: string[] = [];
  for (const t of terms) {
    const v = lines[t.line]?.[i]?.value;
    if (v === null || v === undefined) {
      if (t.optional) omitted.push(labels[t.line] ?? t.line);
      else missing.push(labels[t.line] ?? t.line);
      continue;
    }
    total += t.sign * v;
  }
  if (missing.length > 0) {
    return { value: null, status: "unavailable", formula, note: `Calculation unavailable: missing ${missing.join(", ")}.` };
  }
  return {
    value: total,
    status: "calculated",
    formula,
    note: omitted.length > 0 ? `Not reported and excluded: ${omitted.join(", ")}.` : undefined,
  };
}

export function buildStatementSet(cf: CompanyFactsJson, frequency: "annual" | "quarterly", opts: NormalizeOptions = {}): StatementSet {
  const series = normalizeCompanyFacts(cf, frequency, opts);
  const lines = { ...series.values } as Record<LineId, Cell[]>;
  const n = series.periods.length;
  const idx = Array.from({ length: n }, (_, i) => i);

  // Gross profit: reported, else Revenue − Cost of revenue (calculated).
  lines.grossProfit = lines.grossProfit.map((cell, i) =>
    cell.value !== null
      ? cell
      : (() => {
          const calc = combine(lines, [{ line: "revenue", sign: 1 }, { line: "costOfRevenue", sign: -1 }], i, "Revenue − Cost of revenue");
          return calc.value !== null ? calc : { ...cell, note: `${cell.note ?? ""} Cost of revenue not reported, so gross profit cannot be calculated.`.trim() };
        })(),
  );

  lines.ebitda = idx.map((i) =>
    combine(lines, [{ line: "operatingIncome", sign: 1 }, { line: "depreciationAmortization", sign: 1 }], i, "Operating income + D&A (from cash flow statement)", {
      operatingIncome: "operating income",
      depreciationAmortization: "D&A",
    }),
  );
  lines.freeCashFlow = idx.map((i) =>
    combine(lines, [{ line: "cfo", sign: 1 }, { line: "capex", sign: -1 }], i, "Cash from operations − Capital expenditures", { cfo: "CFO", capex: "capex" }),
  );
  lines.totalDebt = idx.map((i) =>
    combine(lines, [{ line: "shortTermDebt", sign: 1, optional: true }, { line: "longTermDebt", sign: 1, optional: true }], i, "Short-term debt + Long-term debt", {
      shortTermDebt: "short-term debt",
      longTermDebt: "long-term debt",
    }),
  );
  // If neither debt line is reported, total debt is unavailable (not zero).
  lines.totalDebt = lines.totalDebt.map((c, i) =>
    lines.shortTermDebt[i]!.value === null && lines.longTermDebt[i]!.value === null
      ? { value: null, status: "not_reported", formula: c.formula, note: "No debt lines reported for this period." }
      : c,
  );
  lines.netDebt = idx.map((i) =>
    combine(lines, [{ line: "totalDebt", sign: 1 }, { line: "cash", sign: -1 }, { line: "shortTermInvestments", sign: -1, optional: true }], i, "Total debt − Cash − Short-term investments", {
      totalDebt: "total debt",
      cash: "cash",
      shortTermInvestments: "short-term investments",
    }),
  );
  lines.otherOperatingCashFlow = idx.map((i) =>
    combine(
      lines,
      [{ line: "cfo", sign: 1 }, { line: "netIncome", sign: -1 }, { line: "depreciationAmortization", sign: -1 }, { line: "stockBasedComp", sign: -1 }],
      i,
      "CFO − Net income − D&A − SBC (working capital & other, residual)",
      { cfo: "CFO", netIncome: "net income", depreciationAmortization: "D&A", stockBasedComp: "SBC" },
    ),
  );

  return { frequency, periods: series.periods, lines };
}

/** Year-over-year growth between two cells; unavailable if either is missing or the base is ≤ 0. */
export function growth(cur: Cell | undefined, prev: Cell | undefined): number | null {
  if (!cur || !prev || cur.value === null || prev.value === null || prev.value <= 0) return null;
  return cur.value / prev.value - 1;
}
