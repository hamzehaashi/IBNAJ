import { describe, expect, it } from "vitest";
import dhr from "@/lib/data/fixtures/dhr.json";
import nova from "@/lib/data/fixtures/nova.json";
import type { DemoFixture } from "@/lib/data/fixture-types";
import { buildStatementSet } from "@/lib/sec/statements";
import { runDcf, terminalValuePerpetuity } from "./dcf";
import { deriveModelDefaults } from "./defaults";
import { cagr, copyForward, projectForecast, resizeAssumptions } from "./forecast";
import { computeRatios } from "./ratios";
import { axisAround, DEFAULT_SCENARIOS, runScenario, sensitivityGrid } from "./sensitivity";
import type { ForecastAssumptions, ModelBase, ValuationAssumptions } from "./types";
import { computeWacc } from "./wacc";

/*
 * Hand-worked reference case.
 * Base revenue 1,000; base NWC 100; growth 10%; EBIT margin 20%; tax 25%; D&A 5%; capex 6%; NWC 10%.
 *   Y1: rev 1,100  EBIT 220  tax 55  NOPAT 165  D&A 55  capex 66  NWC 110 ΔNWC 10 → FCFF 144
 *   Y2: rev 1,210  EBIT 242  tax 60.5 NOPAT 181.5 D&A 60.5 capex 72.6 NWC 121 ΔNWC 11 → FCFF 158.4
 * WACC 10%, g 2%, end-of-year, full first year:
 *   PV1 = 144/1.1 = 130.9091; PV2 = 158.4/1.21 = 130.9091
 *   TV = 158.4 × 1.02 / 0.08 = 2,019.6; PV(TV) = 2,019.6 / 1.21 = 1,669.0909
 *   EV = 1,930.9091; equity = EV + 50 cash − 200 debt − 10 NCI = 1,770.9091; /100 shares = 17.709091
 */
const base: ModelBase = { baseYear: 2025, baseRevenue: 1000, baseNwc: 100 };
const forecast: ForecastAssumptions = {
  horizon: 2,
  revenueGrowth: [0.1, 0.1],
  marginMethod: "operatingMargin",
  operatingMargin: [0.2, 0.2],
  grossMargin: [0.5, 0.5],
  sgaPct: [0.2, 0.2],
  rndPct: [0.1, 0.1],
  taxRate: [0.25, 0.25],
  daPct: [0.05, 0.05],
  capexPct: [0.06, 0.06],
  nwcPct: [0.1, 0.1],
};
const valuation: ValuationAssumptions = {
  wacc: { riskFreeRate: 0.04, beta: 1.2, equityRiskPremium: 0.05, preTaxCostOfDebt: 0.06, marginalTaxRate: 0.25, debtWeight: 0.3 },
  waccOverride: 0.1,
  terminalMethod: "perpetuity",
  terminalGrowth: 0.02,
  exitMultiple: 10,
  midYearConvention: false,
  stubFraction: 1,
  bridge: { cash: 50, shortTermInvestments: 0, debt: 200, minorityInterest: 10, preferredEquity: 0, nonOperatingAssets: 0 },
  dilutedShares: 100,
  referencePrice: 15,
};

const ok = (r: ReturnType<typeof runDcf>) => {
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r;
};

describe("WACC", () => {
  it("computes CAPM cost of equity and WACC", () => {
    const w = computeWacc(valuation.wacc);
    expect(w.costOfEquity).toBeCloseTo(0.1, 12);
    expect(w.afterTaxCostOfDebt).toBeCloseTo(0.045, 12);
    expect(w.wacc).toBeCloseTo(0.0835, 12);
  });
});

describe("forecast", () => {
  it("projects revenue through FCFF", () => {
    const [y1, y2] = projectForecast(base, forecast);
    expect(y1).toMatchObject({ fiscalYear: 2026, label: "FY2026E" });
    expect(y1!.revenue).toBeCloseTo(1100, 9);
    expect(y1!.nopat).toBeCloseTo(165, 9);
    expect(y1!.deltaNwc).toBeCloseTo(10, 9);
    expect(y1!.fcff).toBeCloseTo(144, 9);
    expect(y2!.fcff).toBeCloseTo(158.4, 9);
    expect(y2!.ebitda).toBeCloseTo(302.5, 9);
  });

  it("cost build-up derives EBIT from gross margin, SG&A and R&D", () => {
    const [y1] = projectForecast(base, { ...forecast, marginMethod: "costBuildUp" });
    expect(y1!.ebit).toBeCloseTo(1100 * (0.5 - 0.2 - 0.1), 9);
    expect(y1!.grossProfit).toBeCloseTo(550, 9);
  });

  it("does not tax operating losses (no NOL modeling)", () => {
    const [y1] = projectForecast(base, { ...forecast, operatingMargin: [-0.1, -0.1] });
    expect(y1!.taxes).toBe(0);
    expect(y1!.nopat).toBeCloseTo(-110, 9);
  });

  it("resizes and copies assumptions forward", () => {
    const r = resizeAssumptions(forecast, 4);
    expect(r.revenueGrowth).toEqual([0.1, 0.1, 0.1, 0.1]);
    const c = copyForward({ ...r, revenueGrowth: [0.1, 0.07, 0.1, 0.1] }, "revenueGrowth", 1);
    expect(c.revenueGrowth).toEqual([0.1, 0.07, 0.07, 0.07]);
  });

  it("CAGR is undefined for non-positive endpoints", () => {
    expect(cagr(100, 121, 2)).toBeCloseTo(0.1, 12);
    expect(cagr(0, 121, 2)).toBeNull();
    expect(cagr(-5, 121, 2)).toBeNull();
  });
});

describe("DCF", () => {
  it("matches the hand-worked perpetuity case", () => {
    const r = ok(runDcf(base, forecast, valuation));
    expect(r.years[0]!.presentValue).toBeCloseTo(130.909091, 5);
    expect(r.terminalValue).toBeCloseTo(2019.6, 9);
    expect(r.pvTerminalValue).toBeCloseTo(1669.090909, 5);
    expect(r.enterpriseValue).toBeCloseTo(1930.909091, 5);
    expect(r.equityValue).toBeCloseTo(1770.909091, 5);
    expect(r.perShare).toBeCloseTo(17.709091, 5);
    expect(r.upside).toBeCloseTo(17.709091 / 15 - 1, 6);
  });

  it("exit-multiple terminal value", () => {
    const r = ok(runDcf(base, forecast, { ...valuation, terminalMethod: "exitMultiple" }));
    expect(r.terminalValue).toBeCloseTo(3025, 9);
    expect(r.pvTerminalValue).toBeCloseTo(2500, 9);
    expect(r.impliedExitMultiple).toBeCloseTo(10, 9);
  });

  it("perpetuity implied cross-check: implied growth recovers g", () => {
    const r = ok(runDcf(base, forecast, valuation));
    expect(r.impliedPerpetualGrowth).toBeCloseTo(0.02, 9);
  });

  it("mid-year convention discounts flows at period midpoints", () => {
    const r = ok(runDcf(base, forecast, { ...valuation, midYearConvention: true }));
    expect(r.years.map((y) => y.discountTime)).toEqual([0.5, 1.5]);
    expect(r.terminalDiscountTime).toBe(1.5);
    expect(r.years[0]!.presentValue).toBeCloseTo(144 / Math.pow(1.1, 0.5), 9);
  });

  it("stub period scales and discounts the partial first year", () => {
    const r = ok(runDcf(base, forecast, { ...valuation, stubFraction: 0.5 }));
    expect(r.years[0]!.cashFlow).toBeCloseTo(72, 9);
    expect(r.years.map((y) => y.discountTime)).toEqual([0.5, 1.5]);
    const mid = ok(runDcf(base, forecast, { ...valuation, stubFraction: 0.5, midYearConvention: true }));
    expect(mid.years.map((y) => y.discountTime)).toEqual([0.25, 1]);
  });

  it("rejects terminal growth ≥ WACC", () => {
    const r = runDcf(base, forecast, { ...valuation, terminalGrowth: 0.1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/must be below WACC/);
  });

  it("rejects invalid inputs with clear errors", () => {
    expect(runDcf(base, { ...forecast, horizon: 11 }, valuation).ok).toBe(false);
    expect(runDcf(base, forecast, { ...valuation, dilutedShares: 0 }).ok).toBe(false);
    expect(runDcf(base, forecast, { ...valuation, waccOverride: 0 }).ok).toBe(false);
    expect(runDcf({ ...base, baseRevenue: 0 }, forecast, valuation).ok).toBe(false);
    expect(runDcf(base, { ...forecast, revenueGrowth: [0.1, Number.NaN] }, valuation).ok).toBe(false);
  });

  it("warns when terminal value dominates enterprise value", () => {
    const r = ok(runDcf(base, forecast, valuation));
    expect(r.terminalShareOfEv).toBeGreaterThan(0.85);
    expect(r.warnings.some((w) => w.includes("Terminal value is"))).toBe(true);
  });

  it("terminal value formula", () => {
    expect(terminalValuePerpetuity(100, 0.09, 0.03)).toBeCloseTo(103 / 0.06, 9);
  });
});

describe("integrated model from fixtures", () => {
  const facts = (dhr as unknown as DemoFixture).companyfacts;
  const annual = buildStatementSet(facts, "annual");
  const quarterly = buildStatementSet(facts, "quarterly");
  const defaults = deriveModelDefaults({ annual, quarterly, marketPrice: 214.5, valuationDate: "2026-10-09" });

  it("initializes from history with labeled sources", () => {
    expect(defaults.base.baseYear).toBe(2025);
    expect(defaults.forecast.horizon).toBe(5);
    expect(defaults.sources.revenueGrowth!.kind).toBe("historical");
    expect(defaults.sources.beta!.kind).toBe("illustrative");
    expect(defaults.valuation.stubFraction).toBeCloseTo(83 / 365, 6);
  });

  it("default WACC is economically plausible (regression: unit errors once produced 1.2%)", () => {
    const r = ok(runDcf(defaults.base, defaults.forecast, defaults.valuation));
    expect(r.wacc.applied).toBeGreaterThan(0.05);
    expect(r.wacc.applied).toBeLessThan(0.15);
    expect(defaults.valuation.wacc.debtWeight).toBeLessThan(0.5);
  });

  it("uses the newest balance sheet (latest 10-Q) for the equity bridge", () => {
    expect(defaults.bridgeAsOf).toContain("Q2 FY2026");
  });

  it("revenue growth 5% → 8% propagates through every dependent output", () => {
    const at = (g: number) => {
      const f = { ...defaults.forecast, revenueGrowth: defaults.forecast.revenueGrowth.map(() => g) };
      return ok(runDcf(defaults.base, f, defaults.valuation));
    };
    const lo = at(0.05);
    const hi = at(0.08);
    const y = (r: typeof lo) => r.years[0]!;
    expect(y(hi).revenue).toBeCloseTo(defaults.base.baseRevenue * 1.08, 3);
    for (const k of ["revenue", "ebit", "ebitda", "taxes", "nopat"] as const) expect(y(hi)[k]).toBeGreaterThan(y(lo)[k]);
    expect(hi.enterpriseValue).toBeGreaterThan(lo.enterpriseValue);
    expect(hi.equityValue - lo.equityValue).toBeCloseTo(hi.enterpriseValue - lo.enterpriseValue, 3);
    expect(hi.perShare).toBeGreaterThan(lo.perShare);
    expect(hi.upside!).toBeGreaterThan(lo.upside!);
  });

  it("sensitivity grid center equals the base-case valuation", () => {
    const inputs = { base: defaults.base, forecast: defaults.forecast, valuation: { ...defaults.valuation, waccOverride: 0.09 } };
    const baseResult = ok(runDcf(inputs.base, inputs.forecast, inputs.valuation));
    const grid = sensitivityGrid(inputs, "wacc", axisAround(0.09, 0.005), "terminalGrowth", axisAround(0.025, 0.005));
    expect(grid.rows[2]![2]!.perShare).toBeCloseTo(baseResult.perShare, 9);
    // Higher WACC → lower value along each row.
    const row = grid.rows[2]!.map((c) => c.perShare!);
    expect([...row].sort((a, b) => b - a)).toEqual(row);
  });

  it("sensitivity marks invalid cells instead of inventing values", () => {
    const inputs = { base: defaults.base, forecast: defaults.forecast, valuation: defaults.valuation };
    const grid = sensitivityGrid(inputs, "wacc", [0.03], "terminalGrowth", [0.035]);
    expect(grid.rows[0]![0]).toMatchObject({ perShare: null });
    expect(grid.rows[0]![0]!.error).toMatch(/below WACC/);
  });

  it("scenarios order bear < base < bull", () => {
    const inputs = { base: defaults.base, forecast: defaults.forecast, valuation: defaults.valuation };
    const [bear, baseCase, bull] = DEFAULT_SCENARIOS.map((s) => runScenario(inputs, s.adjustments));
    expect(bear!.perShare!).toBeLessThan(baseCase!.perShare!);
    expect(baseCase!.perShare!).toBeLessThan(bull!.perShare!);
    expect(baseCase!.revenueCagr).toBeCloseTo(defaults.forecast.revenueGrowth[0]!, 9);
  });

  it("missing-metric company still initializes, with gaps labeled", () => {
    const nf = (nova as unknown as DemoFixture).companyfacts;
    const d = deriveModelDefaults({ annual: buildStatementSet(nf, "annual"), marketPrice: null, valuationDate: "2026-10-09" });
    expect(d.sources.rndPct!.kind).toBe("illustrative");
    expect(d.sources["bridge.debt"]!.kind).toBe("reported");
    expect(d.sources.referencePrice!.kind).toBe("illustrative");
    expect(d.valuation.referencePrice).toBeNull();
    expect(ok(runDcf(d.base, d.forecast, d.valuation)).upside).toBeNull();
  });
});

describe("ratios", () => {
  const set = buildStatementSet((dhr as unknown as DemoFixture).companyfacts, "annual");
  const ratios = computeRatios(set);
  const r = (id: string) => ratios.find((x) => x.id === id)!;

  it("computes margins from statement lines", () => {
    const last = set.periods.length - 1;
    expect(r("grossMargin").points[last]!.value).toBeCloseTo(set.lines.grossProfit[last]!.value! / set.lines.revenue[last]!.value!, 12);
  });

  it("average-balance ratios are unavailable in the first period, with a reason", () => {
    expect(r("roe").points[0]).toMatchObject({ value: null });
    expect(r("roe").points[0]!.reason).toMatch(/prior period/);
    expect(r("roe").points[1]!.value).not.toBeNull();
  });

  it("missing inputs produce reasons, not zeros", () => {
    const novaSet = buildStatementSet((nova as unknown as DemoFixture).companyfacts, "annual");
    const inv = computeRatios(novaSet).find((x) => x.id === "inventoryTurnover")!;
    expect(inv.points.every((p) => p.value === null)).toBe(true);
    expect(inv.points.at(-1)!.reason).toMatch(/inventory/);
  });
});
