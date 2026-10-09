/**
 * Sensitivity and scenario analysis. Every output is produced by re-running the same
 * DCF engine with one or two inputs changed — there is no separate approximation.
 */
import { runDcf } from "./dcf";
import { cagr } from "./forecast";
import type { DcfResult, ForecastAssumptions, ModelBase, ValuationAssumptions } from "./types";
import { computeWacc } from "./wacc";

export interface ModelInputs {
  base: ModelBase;
  forecast: ForecastAssumptions;
  valuation: ValuationAssumptions;
}

export type SensitivityParam = "wacc" | "terminalGrowth" | "exitMultiple" | "revenueGrowthShift" | "operatingMarginShift";

export const SENSITIVITY_LABELS: Record<SensitivityParam, string> = {
  wacc: "WACC",
  terminalGrowth: "Terminal growth",
  exitMultiple: "Exit multiple (EV/EBITDA)",
  revenueGrowthShift: "Revenue growth (Δ all years)",
  operatingMarginShift: "Operating margin (Δ all years)",
};

export const appliedWacc = (v: ValuationAssumptions) => v.waccOverride ?? computeWacc(v.wacc).wacc;

/** Return new inputs with one parameter set. Shifts are additive deltas applied to every forecast year. */
export function applyParam(inputs: ModelInputs, param: SensitivityParam, value: number): ModelInputs {
  const { forecast: f, valuation: v } = inputs;
  switch (param) {
    case "wacc":
      return { ...inputs, valuation: { ...v, waccOverride: value } };
    case "terminalGrowth":
      return { ...inputs, valuation: { ...v, terminalGrowth: value } };
    case "exitMultiple":
      return { ...inputs, valuation: { ...v, exitMultiple: value } };
    case "revenueGrowthShift":
      return { ...inputs, forecast: { ...f, revenueGrowth: f.revenueGrowth.map((g) => g + value) } };
    case "operatingMarginShift":
      // Under cost build-up, the margin shift is applied to gross margin (flows 1:1 to EBIT margin).
      return f.marginMethod === "operatingMargin"
        ? { ...inputs, forecast: { ...f, operatingMargin: f.operatingMargin.map((m) => m + value) } }
        : { ...inputs, forecast: { ...f, grossMargin: f.grossMargin.map((m) => m + value) } };
  }
}

/** Current value of a parameter (shifts are 0 at the base case). */
export function currentParamValue(inputs: ModelInputs, param: SensitivityParam): number {
  switch (param) {
    case "wacc":
      return appliedWacc(inputs.valuation);
    case "terminalGrowth":
      return inputs.valuation.terminalGrowth;
    case "exitMultiple":
      return inputs.valuation.exitMultiple;
    default:
      return 0;
  }
}

export function axisAround(center: number, step: number, count = 5): number[] {
  const half = Math.floor(count / 2);
  return Array.from({ length: count }, (_, i) => Math.round((center + (i - half) * step) * 1e10) / 1e10);
}

export interface SensitivityCell {
  x: number;
  y: number;
  perShare: number | null;
  enterpriseValue: number | null;
  error?: string;
}

export interface SensitivityGrid {
  xParam: SensitivityParam;
  yParam: SensitivityParam;
  xValues: number[];
  yValues: number[];
  /** rows[yIndex][xIndex] */
  rows: SensitivityCell[][];
}

export function sensitivityGrid(inputs: ModelInputs, xParam: SensitivityParam, xValues: number[], yParam: SensitivityParam, yValues: number[]): SensitivityGrid {
  const rows = yValues.map((y) =>
    xValues.map((x) => {
      const r = runDcf(...unpack(applyParam(applyParam(inputs, yParam, y), xParam, x)));
      return r.ok
        ? { x, y, perShare: r.perShare, enterpriseValue: r.enterpriseValue }
        : { x, y, perShare: null, enterpriseValue: null, error: r.errors[0] };
    }),
  );
  return { xParam, yParam, xValues, yValues, rows };
}

const unpack = (i: ModelInputs) => [i.base, i.forecast, i.valuation] as const;

// ------------------------------------------------------------------ scenarios

export interface ScenarioAdjustments {
  revenueGrowthDelta: number;
  operatingMarginDelta: number;
  waccDelta: number;
  terminalGrowthDelta: number;
  exitMultipleDelta: number;
}

export interface Scenario {
  id: string;
  name: string;
  kind: "bear" | "base" | "bull" | "custom";
  adjustments: ScenarioAdjustments;
  /** Defaults are illustrative until the analyst reviews and accepts them. */
  illustrative: boolean;
}

const zero: ScenarioAdjustments = { revenueGrowthDelta: 0, operatingMarginDelta: 0, waccDelta: 0, terminalGrowthDelta: 0, exitMultipleDelta: 0 };

export const DEFAULT_SCENARIOS: Scenario[] = [
  { id: "bear", name: "Bear", kind: "bear", illustrative: true, adjustments: { revenueGrowthDelta: -0.03, operatingMarginDelta: -0.02, waccDelta: 0.01, terminalGrowthDelta: -0.005, exitMultipleDelta: -2 } },
  { id: "base", name: "Base", kind: "base", illustrative: true, adjustments: zero },
  { id: "bull", name: "Bull", kind: "bull", illustrative: true, adjustments: { revenueGrowthDelta: 0.03, operatingMarginDelta: 0.02, waccDelta: -0.005, terminalGrowthDelta: 0.005, exitMultipleDelta: 2 } },
];

export function applyScenario(inputs: ModelInputs, adj: ScenarioAdjustments): ModelInputs {
  let out = applyParam(inputs, "revenueGrowthShift", adj.revenueGrowthDelta);
  out = applyParam(out, "operatingMarginShift", adj.operatingMarginDelta);
  const v = out.valuation;
  return {
    ...out,
    valuation: {
      ...v,
      waccOverride: adj.waccDelta !== 0 ? appliedWacc(v) + adj.waccDelta : v.waccOverride,
      terminalGrowth: v.terminalGrowth + adj.terminalGrowthDelta,
      exitMultiple: v.exitMultiple + adj.exitMultipleDelta,
    },
  };
}

export interface ScenarioSummary {
  revenueCagr: number | null;
  finalEbitdaMargin: number | null;
  wacc: number;
  terminalGrowth: number;
  perShare: number | null;
  impliedReturn: number | null;
  result: DcfResult;
}

export function runScenario(inputs: ModelInputs, adj: ScenarioAdjustments): ScenarioSummary {
  const scenarioInputs = applyScenario(inputs, adj);
  const result = runDcf(...unpack(scenarioInputs));
  const years = result.years;
  const last = years[years.length - 1];
  return {
    revenueCagr: last ? cagr(scenarioInputs.base.baseRevenue, last.revenue, years.length) : null,
    finalEbitdaMargin: last ? last.ebitdaMargin : null,
    wacc: appliedWacc(scenarioInputs.valuation),
    terminalGrowth: scenarioInputs.valuation.terminalGrowth,
    perShare: result.ok ? result.perShare : null,
    impliedReturn: result.ok ? result.upside : null,
    result,
  };
}
