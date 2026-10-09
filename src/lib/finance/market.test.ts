import { describe, expect, it } from "vitest";
import dhr from "@/lib/data/fixtures/dhr.json";
import nova from "@/lib/data/fixtures/nova.json";
import type { DemoFixture } from "@/lib/data/fixture-types";
import { buildStatementSet } from "@/lib/sec/statements";
import { validateUserPrice } from "@/components/workspace/PriceEditor";
import { deriveModelDefaults } from "./defaults";
import { marketMetrics } from "./market";

const sets = (f: unknown) => {
  const cf = (f as DemoFixture).companyfacts;
  return { annual: buildStatementSet(cf, "annual"), quarterly: buildStatementSet(cf, "quarterly") };
};

describe("dividend yield", () => {
  it("uses latest fiscal-year dividends declared per share from filings", () => {
    const { annual, quarterly } = sets(dhr);
    const dps = annual.lines.dividendsPerShare.at(-1)!;
    expect(dps.status).toBe("reported");
    const m = marketMetrics(200, annual, quarterly);
    expect(m.dividendYield.value).toBeCloseTo(dps.value! / 200, 12);
    expect(m.dividendYield.basis).toContain("FY2025");
  });

  it("is unavailable (not zero) when no dividend is reported", () => {
    const { annual, quarterly } = sets(nova);
    const m = marketMetrics(50, annual, quarterly);
    expect(m.dividendYield.value).toBeNull();
    expect(m.dividendYield.reason).toMatch(/No dividends per share reported/);
  });

  it("is unavailable without a price", () => {
    const { annual, quarterly } = sets(dhr);
    expect(marketMetrics(null, annual, quarterly).dividendYield.value).toBeNull();
  });
});

describe("sourced risk-free rate in defaults", () => {
  const { annual, quarterly } = sets(dhr);
  const base = { annual, quarterly, marketPrice: 200, valuationDate: "2026-10-09" };

  it("uses the Treasury yield and labels it as market data", () => {
    const d = deriveModelDefaults({ ...base, riskFree: { rate: 0.0397, asOf: "2026-10-08", tenor: "10 Yr", source: "U.S. Treasury", url: "x" } });
    expect(d.valuation.wacc.riskFreeRate).toBe(0.0397);
    expect(d.sources.riskFreeRate).toMatchObject({ kind: "market" });
    expect(d.sources.riskFreeRate!.description).toContain("10-year U.S. Treasury par yield, 2026-10-08");
  });

  it("falls back to the illustrative rate with the reason when unavailable", () => {
    const d = deriveModelDefaults({ ...base, riskFree: null, riskFreeNote: "Treasury returned HTTP 503." });
    expect(d.valuation.wacc.riskFreeRate).toBe(0.0425);
    expect(d.sources.riskFreeRate).toMatchObject({ kind: "illustrative" });
    expect(d.sources.riskFreeRate!.description).toContain("HTTP 503");
  });

  it("labels a user-entered price as its source", () => {
    const d = deriveModelDefaults({ ...base, marketPriceSource: "User-entered price, as of 2026-10-08" });
    expect(d.sources.referencePrice!.description).toBe("User-entered price, as of 2026-10-08");
  });
});

describe("user price validation", () => {
  it("accepts positive prices dated today or earlier", () => {
    expect(validateUserPrice("214.50", "2026-10-08", "2026-10-09")).toBeNull();
    expect(validateUserPrice("$1,214.50", "2026-10-09", "2026-10-09")).toBeNull();
  });
  it("rejects missing, non-positive, implausible or future-dated prices", () => {
    expect(validateUserPrice("", "2026-10-08", "2026-10-09")).toMatch(/Enter a price/);
    expect(validateUserPrice("0", "2026-10-08", "2026-10-09")).toMatch(/greater than zero/);
    expect(validateUserPrice("abc", "2026-10-08", "2026-10-09")).toMatch(/Enter a price/);
    expect(validateUserPrice("5000000", "2026-10-08", "2026-10-09")).toMatch(/implausible/);
    expect(validateUserPrice("10", "2026-10-10", "2026-10-09")).toMatch(/future/);
  });
});
