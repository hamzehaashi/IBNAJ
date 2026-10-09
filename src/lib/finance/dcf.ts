/**
 * Unlevered free-cash-flow DCF.
 *
 * Discounting (period-aware):
 *   Year 1 covers only the share of the year after the valuation date (`stubFraction`);
 *   its FCFF is scaled by that fraction. End-of-period time for year i is
 *   t_i = stub + (i − 1). With the mid-year convention each cash flow is discounted at
 *   the middle of its own period: t_i − period_i / 2.
 *
 * Terminal value:
 *   Perpetuity: TV = FCFF_N × (1 + g) / (WACC − g). Under mid-year convention the
 *   perpetuity's cash flows also arrive mid-year, so TV is discounted at t_N − 0.5.
 *   Exit multiple: TV = EBITDA_N × multiple, a point-in-time value discounted at t_N.
 *
 * Enterprise → equity bridge:
 *   Equity = EV + cash + short-term investments + non-operating assets
 *            − debt − noncontrolling interest − preferred equity.
 *   Per share = Equity / diluted shares.
 */
import { projectForecast, validateForecastAssumptions } from "./forecast";
import type { BridgeLine, DcfResult, DiscountedYear, ForecastAssumptions, ModelBase, ValuationAssumptions } from "./types";
import { computeWacc, validateWaccInputs } from "./wacc";

export const TERMINAL_SHARE_WARNING = 0.85;
export const HIGH_TERMINAL_GROWTH = 0.04;

export function terminalValuePerpetuity(finalFcff: number, wacc: number, g: number): number {
  return (finalFcff * (1 + g)) / (wacc - g);
}

export function terminalValueExitMultiple(finalEbitda: number, multiple: number): number {
  return finalEbitda * multiple;
}

export function discountFactor(rate: number, time: number): number {
  return 1 / Math.pow(1 + rate, time);
}

export function runDcf(base: ModelBase, forecast: ForecastAssumptions, v: ValuationAssumptions): DcfResult {
  const errors = validateForecastAssumptions(base, forecast);
  const warnings: string[] = [];
  if (errors.length) return { ok: false, errors, warnings, years: [] };

  const years = projectForecast(base, forecast);
  errors.push(...validateWaccInputs(v.wacc));
  const computed = computeWacc(v.wacc);
  const wacc = v.waccOverride ?? computed.wacc;

  if (!Number.isFinite(wacc) || wacc <= 0) errors.push("WACC must be greater than 0%.");
  if (!(v.stubFraction >= 0 && v.stubFraction <= 1)) errors.push("Stub fraction must be between 0 and 1.");
  if (!Number.isFinite(v.dilutedShares) || v.dilutedShares <= 0) errors.push("Diluted share count must be positive.");
  if (v.terminalMethod === "perpetuity") {
    if (!Number.isFinite(v.terminalGrowth)) errors.push("Terminal growth must be a number.");
    else if (v.terminalGrowth >= wacc) {
      errors.push(`Terminal growth (${(v.terminalGrowth * 100).toFixed(2)}%) must be below WACC (${(wacc * 100).toFixed(2)}%); the perpetuity formula is undefined otherwise.`);
    }
  } else if (!Number.isFinite(v.exitMultiple) || v.exitMultiple <= 0) {
    errors.push("Exit multiple must be greater than zero.");
  }
  const bridgeBad = Object.entries(v.bridge).filter(([, x]) => !Number.isFinite(x)).map(([k]) => k);
  if (bridgeBad.length) errors.push(`Bridge inputs must be numbers: ${bridgeBad.join(", ")}.`);
  if (errors.length) return { ok: false, errors, warnings, years };

  if (v.stubFraction === 0) warnings.push("The first forecast year has fully elapsed; its cash flow is excluded. Update historical data when the next annual report is available.");

  const discounted: DiscountedYear[] = years.map((y, i) => {
    const periodFraction = i === 0 ? v.stubFraction : 1;
    const endTime = v.stubFraction + i;
    const discountTime = v.midYearConvention ? endTime - periodFraction / 2 : endTime;
    const df = discountFactor(wacc, discountTime);
    const cashFlow = y.fcff * periodFraction;
    return { ...y, periodFraction, discountTime, discountFactor: df, cashFlow, presentValue: cashFlow * df };
  });

  const last = discounted[discounted.length - 1]!;
  const tN = v.stubFraction + (years.length - 1);
  let terminalValue: number;
  let terminalDiscountTime: number;
  if (v.terminalMethod === "perpetuity") {
    terminalValue = terminalValuePerpetuity(last.fcff, wacc, v.terminalGrowth);
    terminalDiscountTime = v.midYearConvention ? Math.max(tN - 0.5, 0) : tN;
  } else {
    terminalValue = terminalValueExitMultiple(last.ebitda, v.exitMultiple);
    terminalDiscountTime = tN;
  }
  const pvTerminalValue = terminalValue * discountFactor(wacc, terminalDiscountTime);
  const sumPvFcff = discounted.reduce((s, y) => s + y.presentValue, 0);
  const enterpriseValue = sumPvFcff + pvTerminalValue;

  const b = v.bridge;
  const bridge: BridgeLine[] = [
    { label: "Cash & equivalents", amount: b.cash, sign: 1 },
    { label: "Short-term investments", amount: b.shortTermInvestments, sign: 1 },
    { label: "Non-operating assets", amount: b.nonOperatingAssets, sign: 1 },
    { label: "Total debt", amount: b.debt, sign: -1 },
    { label: "Noncontrolling interest", amount: b.minorityInterest, sign: -1 },
    { label: "Preferred equity", amount: b.preferredEquity, sign: -1 },
  ];
  const equityValue = bridge.reduce((s, l) => s + l.sign * l.amount, enterpriseValue);
  const perShare = equityValue / v.dilutedShares;
  const upside = v.referencePrice && v.referencePrice > 0 ? perShare / v.referencePrice - 1 : null;
  const terminalShareOfEv = enterpriseValue !== 0 ? pvTerminalValue / enterpriseValue : NaN;

  // Cross-checks between terminal methods.
  const impliedExitMultiple = last.ebitda > 0 ? terminalValue / last.ebitda : null;
  const impliedPerpetualGrowth = terminalValue + last.fcff !== 0 ? (terminalValue * wacc - last.fcff) / (terminalValue + last.fcff) : null;

  if (terminalValue < 0) warnings.push("Terminal value is negative: final-year free cash flow is negative.");
  if (terminalShareOfEv > TERMINAL_SHARE_WARNING) warnings.push(`Terminal value is ${(terminalShareOfEv * 100).toFixed(0)}% of enterprise value; the valuation is highly sensitive to terminal assumptions.`);
  if (v.terminalMethod === "perpetuity" && v.terminalGrowth > HIGH_TERMINAL_GROWTH) warnings.push(`Terminal growth above ${HIGH_TERMINAL_GROWTH * 100}% exceeds typical long-run nominal economic growth.`);
  if (equityValue < 0) warnings.push("Equity value is negative: claims senior to common equity exceed enterprise value.");

  return {
    ok: true,
    wacc: { ...computed, applied: wacc, overridden: v.waccOverride !== null },
    years: discounted,
    sumPvFcff,
    terminalValue,
    terminalDiscountTime,
    pvTerminalValue,
    enterpriseValue,
    bridge,
    equityValue,
    perShare,
    upside,
    terminalShareOfEv,
    impliedPerpetualGrowth,
    impliedExitMultiple,
    warnings,
  };
}
