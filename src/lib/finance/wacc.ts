import type { WaccInputs, WaccResult } from "./types";

/** Cost of equity via CAPM: rf + β × ERP. */
export function costOfEquity(riskFreeRate: number, beta: number, equityRiskPremium: number): number {
  return riskFreeRate + beta * equityRiskPremium;
}

/** WACC = E/(D+E) × Ke + D/(D+E) × Kd × (1 − t). */
export function computeWacc(inputs: WaccInputs): WaccResult {
  const ke = costOfEquity(inputs.riskFreeRate, inputs.beta, inputs.equityRiskPremium);
  const kd = inputs.preTaxCostOfDebt * (1 - inputs.marginalTaxRate);
  const wd = inputs.debtWeight;
  const we = 1 - wd;
  return { costOfEquity: ke, afterTaxCostOfDebt: kd, equityWeight: we, debtWeight: wd, wacc: we * ke + wd * kd };
}

export function validateWaccInputs(inputs: WaccInputs): string[] {
  const errors: string[] = [];
  const finite = Object.entries(inputs).filter(([, v]) => !Number.isFinite(v)).map(([k]) => k);
  if (finite.length) errors.push(`WACC inputs must be numbers: ${finite.join(", ")}.`);
  if (inputs.debtWeight < 0 || inputs.debtWeight >= 1) errors.push("Debt weight must be between 0% and less than 100%.");
  if (inputs.marginalTaxRate < 0 || inputs.marginalTaxRate >= 1) errors.push("Marginal tax rate must be between 0% and 100%.");
  if (inputs.preTaxCostOfDebt < 0) errors.push("Cost of debt cannot be negative.");
  return errors;
}

/** Market-value debt weight D / (D + E); null when either input is unavailable. */
export function marketDebtWeight(marketCap: number | null, debt: number | null): number | null {
  if (marketCap === null || debt === null || marketCap <= 0 || debt < 0) return null;
  return debt / (debt + marketCap);
}
