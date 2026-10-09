/**
 * Calculation-engine types. The engine is pure: no I/O, no React, no formatting.
 * All rates are decimals (0.05 = 5%). All currency amounts share one unit (USD).
 */

export interface WaccInputs {
  riskFreeRate: number;
  beta: number;
  equityRiskPremium: number;
  preTaxCostOfDebt: number;
  /** Marginal tax rate applied to the debt tax shield. */
  marginalTaxRate: number;
  /** Target debt / (debt + equity). */
  debtWeight: number;
}

export interface WaccResult {
  costOfEquity: number;
  afterTaxCostOfDebt: number;
  equityWeight: number;
  debtWeight: number;
  wacc: number;
}

/**
 * Margin priority rule (explicit, to avoid two assumptions determining EBIT):
 *  - "operatingMargin": EBIT = Revenue × operating margin. Cost lines are not forecast.
 *  - "costBuildUp":     EBIT = Revenue × gross margin − SG&A − R&D. Operating margin is an output.
 */
export type MarginMethod = "operatingMargin" | "costBuildUp";

export interface ForecastAssumptions {
  /** Forecast horizon in years, 1–10. */
  horizon: number;
  /** Per-year arrays (index 0 = first forecast year); must have ≥ horizon entries. */
  revenueGrowth: number[];
  marginMethod: MarginMethod;
  operatingMargin: number[];
  grossMargin: number[];
  sgaPct: number[];
  rndPct: number[];
  taxRate: number[];
  daPct: number[];
  capexPct: number[];
  /** Operating net working capital as % of revenue. */
  nwcPct: number[];
}

export interface BridgeInputs {
  cash: number;
  shortTermInvestments: number;
  debt: number;
  minorityInterest: number;
  preferredEquity: number;
  nonOperatingAssets: number;
}

export type TerminalMethod = "perpetuity" | "exitMultiple";

export interface ValuationAssumptions {
  wacc: WaccInputs;
  /** When set, used instead of the computed WACC. */
  waccOverride: number | null;
  terminalMethod: TerminalMethod;
  terminalGrowth: number;
  /** EV / EBITDA applied to final-year EBITDA. */
  exitMultiple: number;
  midYearConvention: boolean;
  /** Share of the first forecast year remaining after the valuation date, in [0, 1]. */
  stubFraction: number;
  bridge: BridgeInputs;
  dilutedShares: number;
  referencePrice: number | null;
}

export interface ModelBase {
  /** Last historical fiscal year (forecast year 1 = baseYear + 1). */
  baseYear: number;
  baseRevenue: number;
  /** Base-year operating NWC; null if not derivable (ΔNWC in year 1 then uses forecast % only). */
  baseNwc: number | null;
}

export interface ForecastYear {
  index: number;
  fiscalYear: number;
  label: string;
  revenue: number;
  revenueGrowth: number;
  grossProfit: number | null;
  sga: number | null;
  rnd: number | null;
  ebit: number;
  ebitMargin: number;
  da: number;
  ebitda: number;
  ebitdaMargin: number;
  taxRate: number;
  taxes: number;
  nopat: number;
  capex: number;
  nwc: number;
  deltaNwc: number;
  fcff: number;
}

export interface DiscountedYear extends ForecastYear {
  /** Share of the year's FCFF that falls after the valuation date. */
  periodFraction: number;
  /** Time (years from valuation date) at which the cash flow is discounted. */
  discountTime: number;
  discountFactor: number;
  cashFlow: number;
  presentValue: number;
}

export interface BridgeLine {
  label: string;
  amount: number;
  /** +1 adds to enterprise value, −1 subtracts. */
  sign: 1 | -1;
}

export interface DcfSuccess {
  ok: true;
  wacc: WaccResult & { applied: number; overridden: boolean };
  years: DiscountedYear[];
  sumPvFcff: number;
  terminalValue: number;
  terminalDiscountTime: number;
  pvTerminalValue: number;
  enterpriseValue: number;
  bridge: BridgeLine[];
  equityValue: number;
  perShare: number;
  upside: number | null;
  terminalShareOfEv: number;
  impliedPerpetualGrowth: number | null;
  impliedExitMultiple: number | null;
  warnings: string[];
}

export interface DcfFailure {
  ok: false;
  errors: string[];
  warnings: string[];
  years: ForecastYear[];
}

export type DcfResult = DcfSuccess | DcfFailure;
