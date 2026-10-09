import { describe, expect, it } from "vitest";
import dhr from "@/lib/data/fixtures/dhr.json";
import msft from "@/lib/data/fixtures/msft.json";
import aapl from "@/lib/data/fixtures/aapl.json";
import nova from "@/lib/data/fixtures/nova.json";
import rstd from "@/lib/data/fixtures/rstd.json";
import type { DemoFixture } from "@/lib/data/fixture-types";
import type { CompanyFactsJson } from "./types";
import { detectFiscalQuarters, detectFiscalYears, normalizeCompanyFacts, pickLatest } from "./xbrl";
import { buildStatementSet } from "./statements";
import { validateStatements } from "./validation";

const cf = (f: unknown) => (f as DemoFixture).companyfacts;

describe("fiscal calendar detection", () => {
  it("DHR: calendar fiscal years labeled by period, not by the filing's fy", () => {
    const years = detectFiscalYears(cf(dhr));
    expect(years.map((y) => y.key)).toEqual(["FY2020", "FY2021", "FY2022", "FY2023", "FY2024", "FY2025"]);
    expect(years[0]).toMatchObject({ start: "2020-01-01", end: "2020-12-31", days: 366 });
  });

  it("MSFT: non-calendar fiscal year ending June 30", () => {
    const years = detectFiscalYears(cf(msft));
    const fy26 = years.find((y) => y.fiscalYear === 2026)!;
    expect(fy26).toMatchObject({ start: "2025-07-01", end: "2026-06-30" });
  });

  it("AAPL: 52/53-week fiscal years including a 371-day FY2023", () => {
    const years = detectFiscalYears(cf(aapl));
    const fy23 = years.find((y) => y.fiscalYear === 2023)!;
    expect(fy23).toMatchObject({ start: "2022-09-25", end: "2023-09-30", days: 371 });
    expect(years.find((y) => y.fiscalYear === 2024)!.days).toBe(364);
  });

  it("detects quarters from 10-Q facts, with Q4 ending at fiscal year end", () => {
    const years = detectFiscalYears(cf(msft));
    const qs = detectFiscalQuarters(cf(msft), years).filter((q) => q.fiscalYear === 2026);
    expect(qs.map((q) => [q.fiscalQuarter, q.start, q.end])).toEqual([
      [1, "2025-07-01", "2025-09-30"],
      [2, "2025-10-01", "2025-12-31"],
      [3, "2026-01-01", "2026-03-31"],
      [4, "2026-04-01", "2026-06-30"],
    ]);
  });

  it("includes quarters of the in-progress fiscal year (10-Qs filed after the last 10-K)", () => {
    const q = normalizeCompanyFacts(cf(dhr), "quarterly");
    const keys = q.periods.map((p) => p.key);
    expect(keys.slice(-2)).toEqual(["FY2026-Q1", "FY2026-Q2"]);
    const q2 = keys.indexOf("FY2026-Q2");
    expect(q.values.cfo[q2]).toMatchObject({ status: "derived", formula: "YTD through Q2 − YTD through Q1" });
    expect(q.values.totalAssets[q2]!.sources![0]!.end).toBe("2026-06-30");
  });

  it("respects point-in-time: a fiscal year is invisible before its 10-K was filed", () => {
    const years = detectFiscalYears(cf(dhr), { asOf: "2026-01-15" });
    expect(years.at(-1)!.key).toBe("FY2024");
  });
});

describe("period values", () => {
  it("deduplicates 10-K comparative observations of the same period", () => {
    const facts = cf(dhr);
    const obs = facts.facts["us-gaap"]!.RevenueFromContractWithCustomerExcludingAssessedTax!.units.USD!.filter(
      (o) => o.start === "2022-01-01" && o.end === "2022-12-31",
    );
    expect(obs.length).toBe(3); // FY2022, FY2023 and FY2024 10-Ks
    const annual = normalizeCompanyFacts(facts, "annual");
    const i = annual.periods.findIndex((p) => p.key === "FY2022");
    expect(annual.values.revenue[i]!.value).toBe(obs[0]!.val);
    expect(annual.values.revenue[i]!.status).toBe("reported");
  });

  it("balance sheet values are snapshots at the period-end date, not sums", () => {
    const annual = normalizeCompanyFacts(cf(dhr), "annual");
    const i = annual.periods.findIndex((p) => p.key === "FY2024");
    const assets = annual.values.totalAssets[i]!;
    expect(assets.status).toBe("reported");
    expect(assets.sources![0]!.end).toBe("2024-12-31");
    expect(assets.sources![0]!.start).toBeUndefined();
    const le = annual.values.liabilitiesAndEquity[i]!.value!;
    expect(assets.value).toBe(le);
  });

  it("derives Q2/Q3 cash flows from YTD and Q4 from FY − 9M YTD, with provenance", () => {
    const q = normalizeCompanyFacts(cf(msft), "quarterly");
    const fy = normalizeCompanyFacts(cf(msft), "annual");
    const keys = q.periods.map((p) => p.key);
    const cfoQ = ["FY2026-Q1", "FY2026-Q2", "FY2026-Q3", "FY2026-Q4"].map((k) => q.values.cfo[keys.indexOf(k)]!);
    expect(cfoQ.map((c) => c.status)).toEqual(["reported", "derived", "derived", "derived"]);
    expect(cfoQ[1]!.formula).toBe("YTD through Q2 − YTD through Q1");
    expect(cfoQ[3]!.formula).toBe("FY − YTD through Q3");
    expect(cfoQ[3]!.sources).toHaveLength(2);
    const annualCfo = fy.values.cfo[fy.periods.findIndex((p) => p.key === "FY2026")]!.value!;
    const sum = cfoQ.reduce((s, c) => s + c.value!, 0);
    expect(sum).toBe(annualCfo);
  });

  it("income-statement quarters use discrete 3-month facts when reported", () => {
    const q = normalizeCompanyFacts(cf(aapl), "quarterly");
    const i = q.periods.findIndex((p) => p.key === "FY2025-Q2");
    expect(q.values.revenue[i]!.status).toBe("reported");
    expect(q.values.revenue[q.periods.findIndex((p) => p.key === "FY2025-Q4")]!.status).toBe("derived");
  });

  it("never derives per-share values by subtraction", () => {
    const q = normalizeCompanyFacts(cf(msft), "quarterly");
    const i = q.periods.findIndex((p) => p.key === "FY2026-Q4");
    expect(q.values.epsDiluted[i]).toMatchObject({ value: null, status: "unavailable" });
  });

  it("missing tags are not_reported (null), never zero", () => {
    const annual = normalizeCompanyFacts(cf(nova), "annual");
    const last = annual.periods.length - 1;
    expect(annual.values.rnd[last]).toMatchObject({ value: null, status: "not_reported" });
    expect(annual.values.inventory[last]!.value).toBeNull();
    const fy23 = annual.periods.findIndex((p) => p.key === "FY2023");
    expect(annual.values.depreciationAmortization[fy23]!.value).toBeNull();
    expect(annual.values.depreciationAmortization[fy23 + 1]!.value).not.toBeNull();
  });
});

describe("restatements and point-in-time", () => {
  const facts = cf(rstd);
  const fyIndex = (set: { periods: { key: string }[] }, key: string) => set.periods.findIndex((p) => p.key === key);

  it("latest view uses the restated value and records the original", () => {
    const annual = normalizeCompanyFacts(facts, "annual");
    const cell = annual.values.revenue[fyIndex(annual, "FY2023")]!;
    expect(cell.sources![0]!.form).toBe("10-K"); // FY2025 10-K comparative (latest filing)
    expect(cell.restatement).toBeDefined();
    expect(cell.value!).toBeLessThan(cell.restatement!.originalValue);
    expect(cell.restatement!.originalForm).toBe("10-K");
  });

  it("as-of view before the amendment sees only the original figure", () => {
    const pit = normalizeCompanyFacts(facts, "annual", { asOf: "2024-06-30" });
    const cell = pit.values.revenue[fyIndex(pit, "FY2023")]!;
    expect(cell.restatement).toBeUndefined();
    expect(cell.sources![0]!.filed).toBe("2024-02-19");
    const after = normalizeCompanyFacts(facts, "annual", { asOf: "2024-09-01" });
    expect(after.values.revenue[fyIndex(after, "FY2023")]!.sources![0]!.form).toBe("10-K/A");
  });

  it("validation reports the restatement without altering values", () => {
    const set = buildStatementSet(facts, "annual");
    const issues = validateStatements(set, facts);
    expect(issues.some((i) => i.check === "Restatement" && i.period === "FY2023")).toBe(true);
  });
});

describe("units and scale", () => {
  it("share counts are absolute shares and EPS is per share (regression: fixtures once emitted millions)", () => {
    const annual = normalizeCompanyFacts(cf(dhr), "annual");
    const last = annual.periods.length - 1;
    const shares = annual.values.dilutedShares[last]!.value!;
    const ni = annual.values.netIncome[last]!.value!;
    const eps = annual.values.epsDiluted[last]!.value!;
    expect(shares).toBeGreaterThan(1e8);
    expect(eps).toBeCloseTo(ni / shares, 2);
  });
});

describe("pickLatest", () => {
  it("prefers latest filing, then amendments, then later accession", () => {
    const base = { start: "2024-01-01", end: "2024-12-31", fy: 2024, fp: "FY", taxonomy: "us-gaap", tag: "X", unit: "USD" };
    const r = pickLatest([
      { ...base, val: 1, accn: "a", form: "10-K", filed: "2025-02-01" },
      { ...base, val: 2, accn: "b", form: "10-K/A", filed: "2025-02-01" },
      { ...base, val: 3, accn: "c", form: "10-K", filed: "2025-01-01" },
    ])!;
    expect(r.chosen.val).toBe(2);
    expect(r.original.val).toBe(3);
  });
});

describe("statements and validation", () => {
  it.each([["DHR", dhr], ["MSFT", msft], ["AAPL", aapl]])("%s balance sheets pass the identity check", (_t, f) => {
    const facts = cf(f);
    const set = buildStatementSet(facts, "annual");
    const errors = validateStatements(set, facts).filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it.each([["DHR", dhr], ["MSFT", msft], ["AAPL", aapl]])("%s well-formed fixtures raise no warnings (regression: stray EPS facts)", (_t, f) => {
    const facts = cf(f);
    const issues = validateStatements(buildStatementSet(facts, "annual"), facts).filter((i) => i.severity !== "info");
    expect(issues).toEqual([]);
  });

  it("reports non-numeric raw observations instead of silently dropping them", () => {
    const facts: CompanyFactsJson = {
      cik: 1,
      entityName: "NaN Test",
      facts: { "us-gaap": { Revenues: { units: { USD: [{ start: "2024-01-01", end: "2024-12-31", val: null as unknown as number, accn: "x", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" }] } } } },
    };
    const issues = validateStatements(buildStatementSet(facts, "annual"), facts);
    expect(issues.some((i) => i.check === "Non-numeric values")).toBe(true);
  });

  it("calculated lines are flagged as calculated with a formula", () => {
    const set = buildStatementSet(cf(dhr), "annual");
    const ebitda = set.lines.ebitda.at(-1)!;
    expect(ebitda.status).toBe("calculated");
    expect(ebitda.value).toBe(set.lines.operatingIncome.at(-1)!.value! + set.lines.depreciationAmortization.at(-1)!.value!);
  });

  it("calculations with missing inputs are unavailable, not zero-filled", () => {
    const set = buildStatementSet(cf(nova), "annual");
    expect(set.lines.grossProfit.at(-1)!.value).toBeNull();
    const fy23 = set.periods.findIndex((p) => p.key === "FY2023");
    expect(set.lines.ebitda[fy23]).toMatchObject({ value: null, status: "unavailable" });
    expect(set.lines.totalDebt.at(-1)!.status).not.toBe("not_reported");
  });

  it("flags unexpected units", () => {
    const facts: CompanyFactsJson = {
      cik: 1,
      entityName: "Units Test",
      facts: { "us-gaap": { Revenues: { units: { EUR: [{ start: "2024-01-01", end: "2024-12-31", val: 5, accn: "x", fy: 2024, fp: "FY", form: "10-K", filed: "2025-02-01" }] } } } },
    };
    const set = buildStatementSet(facts, "annual");
    expect(validateStatements(set, facts).some((i) => i.check === "Units")).toBe(true);
  });
});
