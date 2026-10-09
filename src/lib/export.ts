/**
 * CSV exports. Values are exported unrounded in full units (USD, shares) so downstream
 * spreadsheets reconcile exactly; missing values are empty cells with a status column.
 */
import { METRICS, type MetricId } from "@/lib/sec/concepts";
import type { LineId, StatementSet } from "@/lib/sec/statements";
import type { DcfResult, ForecastAssumptions, ValuationAssumptions } from "@/lib/finance/types";

const esc = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(esc).join(",")).join("\n") + "\n";

const CALC_LABELS: Record<string, string> = {
  ebitda: "EBITDA (calculated)",
  freeCashFlow: "Free cash flow (calculated)",
  totalDebt: "Total debt (calculated)",
  netDebt: "Net debt (calculated)",
  otherOperatingCashFlow: "Working capital & other (calculated)",
};
export const lineLabel = (id: LineId) => (id in METRICS ? METRICS[id as MetricId].label : (CALC_LABELS[id] ?? id));

export function statementsCsv(set: StatementSet, lines: LineId[], meta: { company: string; source: string; notice?: string }): string {
  const rows: unknown[][] = [
    [`${meta.company} — ${set.frequency} financial statements`],
    [`Source: ${meta.source}`],
    ...(meta.notice ? [[meta.notice]] : []),
    ["Units: USD (absolute) unless stated; shares in absolute count"],
    [],
    ["Line", ...set.periods.map((p) => `${p.label} (${p.start} to ${p.end})`), ...set.periods.map((p) => `${p.label} status`)],
  ];
  for (const id of lines) {
    const cells = set.lines[id] ?? [];
    rows.push([lineLabel(id), ...cells.map((c) => c.value), ...cells.map((c) => c.status)]);
  }
  return toCsv(rows);
}

export function modelCsv(company: string, forecast: ForecastAssumptions, valuation: ValuationAssumptions, result: DcfResult): string {
  const y = result.years;
  const rows: unknown[][] = [
    [`${company} — Caldun DCF model export`],
    ["Rates are decimals; amounts in USD"],
    [],
    ["Assumption", ...y.map((r) => r.label)],
    ["Revenue growth", ...forecast.revenueGrowth.slice(0, forecast.horizon)],
    ["Margin method", forecast.marginMethod],
    ...(forecast.marginMethod === "operatingMargin"
      ? [["Operating margin", ...forecast.operatingMargin.slice(0, forecast.horizon)]]
      : [
          ["Gross margin", ...forecast.grossMargin.slice(0, forecast.horizon)],
          ["SG&A % revenue", ...forecast.sgaPct.slice(0, forecast.horizon)],
          ["R&D % revenue", ...forecast.rndPct.slice(0, forecast.horizon)],
        ]),
    ["Tax rate", ...forecast.taxRate.slice(0, forecast.horizon)],
    ["D&A % revenue", ...forecast.daPct.slice(0, forecast.horizon)],
    ["Capex % revenue", ...forecast.capexPct.slice(0, forecast.horizon)],
    ["NWC % revenue", ...forecast.nwcPct.slice(0, forecast.horizon)],
    [],
    ["Forecast", ...y.map((r) => r.label)],
    ["Revenue", ...y.map((r) => r.revenue)],
    ["EBIT", ...y.map((r) => r.ebit)],
    ["D&A", ...y.map((r) => r.da)],
    ["EBITDA", ...y.map((r) => r.ebitda)],
    ["Taxes", ...y.map((r) => r.taxes)],
    ["NOPAT", ...y.map((r) => r.nopat)],
    ["Capex", ...y.map((r) => r.capex)],
    ["Change in NWC", ...y.map((r) => r.deltaNwc)],
    ["FCFF", ...y.map((r) => r.fcff)],
  ];
  if (result.ok) {
    rows.push(
      ["Period fraction", ...result.years.map((r) => r.periodFraction)],
      ["Discount time (years)", ...result.years.map((r) => r.discountTime)],
      ["Discount factor", ...result.years.map((r) => r.discountFactor)],
      ["PV of FCFF", ...result.years.map((r) => r.presentValue)],
      [],
      ["Valuation"],
      ["WACC applied", result.wacc.applied],
      ["Cost of equity", result.wacc.costOfEquity],
      ["After-tax cost of debt", result.wacc.afterTaxCostOfDebt],
      ["Terminal method", valuation.terminalMethod],
      ["Terminal growth", valuation.terminalGrowth],
      ["Exit multiple", valuation.exitMultiple],
      ["Mid-year convention", valuation.midYearConvention],
      ["Stub fraction", valuation.stubFraction],
      ["Sum of PV(FCFF)", result.sumPvFcff],
      ["Terminal value", result.terminalValue],
      ["PV of terminal value", result.pvTerminalValue],
      ["Enterprise value", result.enterpriseValue],
      ...result.bridge.map((b) => [`${b.sign > 0 ? "+" : "−"} ${b.label}`, b.amount]),
      ["Equity value", result.equityValue],
      ["Diluted shares", valuation.dilutedShares],
      ["Value per share", result.perShare],
      ["Reference price", valuation.referencePrice],
      ["Implied upside/downside", result.upside],
    );
  } else {
    rows.push([], ["Valuation errors"], ...result.errors.map((e) => [e]));
  }
  return toCsv(rows);
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
