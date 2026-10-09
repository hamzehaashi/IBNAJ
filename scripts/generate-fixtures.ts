/**
 * Deterministic generator for Caldun demonstration fixtures.
 *
 * Output files mimic the STRUCTURE of SEC EDGAR `companyfacts` + `submissions` payloads
 * (10-K comparatives, filing-level fy/fp, 10-Q YTD cash flows, 52/53-week years,
 * non-calendar fiscal years, 10-K/A restatements, missing tags).
 *
 * ALL NUMERIC VALUES ARE SYNTHETIC. They are not, and must never be presented as,
 * the reported financials of the named companies.
 *
 * Usage: npm run fixtures
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { CompanyFactsJson, RawFactObservation, SubmissionsJson } from "../src/lib/sec/types";
import type { DemoFixture } from "../src/lib/data/fixture-types";

const OUT_DIR = path.resolve(__dirname, "../src/lib/data/fixtures");
/** Fixture "knowledge date": filings dated after this are not emitted. */
const AS_OF = "2026-10-02";

interface Spec {
  ticker: string;
  cik: number;
  name: string;
  exchange: string;
  sic: string;
  sicDescription: string;
  city: string;
  state: string;
  /**
   * Fiscal year end dates, oldest first. The first entry only anchors the first year's start.
   * The LAST entry is the in-progress fiscal year: only its 10-Qs filed by AS_OF are emitted.
   */
  fyEnds: string[];
  /** 52/53-week calendars use 13-week quarters; others use calendar month-ends. */
  weekBased: boolean;
  /** How many of the most recent fiscal years get 10-Q filings. */
  quarterlyYears: number;
  revenue0: number;
  growth: number[];
  grossMargin: number;
  sgaPct: number;
  rndPct: number | null;
  daPct: number;
  capexPct: number;
  sbcPct: number;
  taxRate: number;
  interest: number | null;
  shares0: number;
  shareDrift: number;
  cash0: number;
  debtLong: number;
  debtCurrent: number;
  goodwill: number;
  price: number;
  /** Tags to omit entirely (simulates companies that never report them). */
  omit?: string[];
  /** Omit a tag only for specific fiscal-year ends (simulates gaps). */
  omitForYears?: Record<string, string[]>;
  /** Restatement: FY end restated by a 10-K/A filed later; revenue multiplied by factor. */
  restate?: { fyEnd: string; revenueFactor: number; amendmentFiled: string };
  revenueTag?: string;
}

// ---------------------------------------------------------------- date helpers
const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(toDate(s).getTime() + n * DAY));
const lastDayOfMonth = (y: number, m0: number) => iso(new Date(Date.UTC(y, m0 + 1, 0)));
const round = (n: number) => Math.round(n);

function quarterEnds(start: string, end: string, weekBased: boolean): string[] {
  if (weekBased) return [addDays(start, 91 - 1), addDays(start, 182 - 1), addDays(start, 273 - 1), end];
  const s = toDate(start);
  const out: string[] = [];
  for (let q = 1; q <= 3; q++) out.push(lastDayOfMonth(s.getUTCFullYear(), s.getUTCMonth() + 3 * q - 1));
  out.push(end);
  return out;
}

// ---------------------------------------------------------------- financial model
interface YearModel {
  start: string;
  end: string;
  flows: Record<string, number>;
  bs: Record<string, number>;
}

const Q_WEIGHTS = [0.24, 0.25, 0.25, 0.26];

function buildYears(spec: Spec): { years: YearModel[]; openingBs: Record<string, number> } {
  const years: YearModel[] = [];
  let revenue = spec.revenue0;
  const bsOf = (rev: number, cogs: number, cash: number, i: number) => {
    const ar = rev * 0.14;
    const inv = spec.omit?.includes("InventoryNet") ? 0 : cogs * 0.22;
    const otherCA = rev * 0.05;
    const sti = rev * 0.03;
    const ppe = rev * 0.18 + i * rev * 0.004;
    const intangibles = spec.goodwill * 0.45 * Math.pow(0.93, i);
    const otherNCA = rev * 0.06;
    const assetsCurrent = cash + sti + ar + inv + otherCA;
    const assets = assetsCurrent + ppe + spec.goodwill + intangibles + otherNCA;
    const ap = cogs * 0.12;
    const accrued = rev * 0.08;
    const debtCurrent = spec.debtCurrent;
    const liabCurrent = ap + accrued + debtCurrent;
    const ltd = spec.debtLong * Math.pow(0.97, i);
    const otherNCL = rev * 0.07;
    const liabilities = liabCurrent + ltd + otherNCL;
    const minority = rev * 0.002;
    const equity = assets - liabilities - minority;
    return {
      CashAndCashEquivalentsAtCarryingValue: cash,
      ShortTermInvestments: sti,
      AccountsReceivableNetCurrent: ar,
      InventoryNet: inv,
      AssetsCurrent: assetsCurrent,
      PropertyPlantAndEquipmentNet: ppe,
      Goodwill: spec.goodwill,
      IntangibleAssetsNetExcludingGoodwill: intangibles,
      Assets: assets,
      AccountsPayableCurrent: ap,
      LiabilitiesCurrent: liabCurrent,
      DebtCurrent: debtCurrent,
      LongTermDebtNoncurrent: ltd,
      Liabilities: liabilities,
      MinorityInterest: minority,
      StockholdersEquity: equity,
      LiabilitiesAndStockholdersEquity: assets,
    };
  };

  const rev0Prev = spec.revenue0 / (1 + spec.growth[0]!);
  const openingBs = bsOf(rev0Prev, rev0Prev * (1 - spec.grossMargin), spec.cash0, -1);
  let prevBs = openingBs;
  let shares = spec.shares0;

  for (let i = 1; i < spec.fyEnds.length; i++) {
    const start = addDays(spec.fyEnds[i - 1]!, 1);
    const end = spec.fyEnds[i]!;
    if (i > 1) revenue = revenue * (1 + spec.growth[i - 1]!);
    const cogs = revenue * (1 - spec.grossMargin);
    const grossProfit = revenue - cogs;
    const sga = revenue * spec.sgaPct;
    const rnd = spec.rndPct === null ? 0 : revenue * spec.rndPct;
    const da = revenue * spec.daPct;
    const operatingIncome = grossProfit - sga - rnd;
    const interest = spec.interest ?? 0;
    const pretax = operatingIncome - interest;
    const tax = pretax * spec.taxRate;
    const netIncome = pretax - tax;
    shares = shares * (1 + spec.shareDrift);
    const sbc = revenue * spec.sbcPct;
    const capex = revenue * spec.capexPct;

    // Cash evolves deterministically; flows reconcile to the change in cash.
    const cash = prevBs.CashAndCashEquivalentsAtCarryingValue! + (netIncome + da - capex) * 0.12;
    const bs = bsOf(revenue, cogs, cash, i - 1);
    const wcAdj = -(
      bs.AccountsReceivableNetCurrent - prevBs.AccountsReceivableNetCurrent! +
      (bs.InventoryNet - prevBs.InventoryNet!) -
      (bs.AccountsPayableCurrent - prevBs.AccountsPayableCurrent!)
    );
    const cfo = netIncome + da + sbc + wcAdj;
    const cfi = -capex - revenue * 0.01;
    const netChange = cash - prevBs.CashAndCashEquivalentsAtCarryingValue!;
    const cff = netChange - cfo - cfi;

    const flows: Record<string, number> = {
      [spec.revenueTag ?? "RevenueFromContractWithCustomerExcludingAssessedTax"]: revenue,
      CostOfRevenue: cogs,
      GrossProfit: grossProfit,
      SellingGeneralAndAdministrativeExpense: sga,
      ResearchAndDevelopmentExpense: rnd,
      OperatingIncomeLoss: operatingIncome,
      InterestExpense: interest,
      IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest: pretax,
      IncomeTaxExpenseBenefit: tax,
      NetIncomeLoss: netIncome,
      DepreciationDepletionAndAmortization: da,
      ShareBasedCompensation: sbc,
      NetCashProvidedByUsedInOperatingActivities: cfo,
      PaymentsToAcquirePropertyPlantAndEquipment: capex,
      NetCashProvidedByUsedInInvestingActivities: cfi,
      NetCashProvidedByUsedInFinancingActivities: cff,
      CashAndCashEquivalentsPeriodIncreaseDecrease: netChange,
      WeightedAverageNumberOfDilutedSharesOutstanding: shares,
    };
    years.push({ start, end, flows, bs });
    prevBs = bs;
  }
  return { years, openingBs };
}

// ---------------------------------------------------------------- fact emission
class FactSink {
  facts: CompanyFactsJson["facts"] = { "us-gaap": {}, dei: {} };
  add(taxonomy: string, tag: string, unit: string, obs: RawFactObservation) {
    const tax = (this.facts[taxonomy] ??= {});
    const concept = (tax[tag] ??= { label: tag, description: null, units: {} });
    (concept.units[unit] ??= []).push(obs);
  }
}

const PER_SHARE = new Set(["EarningsPerShareDiluted"]);
const SHARE_UNITS = new Set(["WeightedAverageNumberOfDilutedSharesOutstanding"]);
const CF_TAGS = new Set([
  "DepreciationDepletionAndAmortization",
  "ShareBasedCompensation",
  "NetCashProvidedByUsedInOperatingActivities",
  "PaymentsToAcquirePropertyPlantAndEquipment",
  "NetCashProvidedByUsedInInvestingActivities",
  "NetCashProvidedByUsedInFinancingActivities",
  "CashAndCashEquivalentsPeriodIncreaseDecrease",
]);

function unitFor(tag: string) {
  if (PER_SHARE.has(tag)) return "USD/shares";
  if (SHARE_UNITS.has(tag)) return "shares";
  return "USD";
}

function generate(spec: Spec): DemoFixture {
  const { years, openingBs } = buildYears(spec);
  const sink = new FactSink();
  let seq = 1;
  const accn = (filed: string) => `${String(spec.cik).padStart(10, "0")}-${filed.slice(2, 4)}-${String(seq++).padStart(6, "0")}`;
  const omitted = (tag: string, fyEnd: string) =>
    spec.omit?.includes(tag) || spec.omitForYears?.[fyEnd]?.includes(tag);

  const emitFlows = (
    flows: Record<string, number>,
    start: string,
    end: string,
    fyEnd: string,
    filing: { accn: string; fy: number; fp: string; form: string; filed: string },
  ) => {
    for (const [tag, val] of Object.entries(flows)) {
      if (omitted(tag, fyEnd)) continue;
      // Model values are in millions (USD millions, shares millions); XBRL reports absolute units.
      const v = round(val * 1e6);
      sink.add("us-gaap", tag, unitFor(tag), { start, end, val: v, ...filing });
    }
    // EPS belongs with the income statement; cash-flow-only passes carry no net income.
    if (flows.NetIncomeLoss !== undefined && !omitted("EarningsPerShareDiluted", fyEnd)) {
      const eps = Math.round((flows.NetIncomeLoss! / flows.WeightedAverageNumberOfDilutedSharesOutstanding!) * 100) / 100;
      sink.add("us-gaap", "EarningsPerShareDiluted", "USD/shares", { start, end, val: eps, ...filing });
    }
  };
  const emitBs = (bs: Record<string, number>, instant: string, fyEnd: string, filing: { accn: string; fy: number; fp: string; form: string; filed: string }) => {
    for (const [tag, val] of Object.entries(bs)) {
      if (omitted(tag, fyEnd)) continue;
      sink.add("us-gaap", tag, "USD", { end: instant, val: round(val * 1e6), ...filing });
    }
  };
  const fyLabel = (end: string) => {
    const d = toDate(end);
    return d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  };
  const scale = (flows: Record<string, number>, w: number) =>
    Object.fromEntries(Object.entries(flows).map(([k, v]) => [k, SHARE_UNITS.has(k) ? v : v * w]));
  const restated = (y: YearModel): YearModel => {
    if (!spec.restate || spec.restate.fyEnd !== y.end) return y;
    const f = { ...y.flows };
    const revTag = spec.revenueTag ?? "RevenueFromContractWithCustomerExcludingAssessedTax";
    const delta = f[revTag]! * (1 - spec.restate.revenueFactor);
    f[revTag] = f[revTag]! - delta;
    f.GrossProfit = f.GrossProfit! - delta;
    f.OperatingIncomeLoss = f.OperatingIncomeLoss! - delta;
    const pretaxTag = "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest";
    f[pretaxTag] = f[pretaxTag]! - delta;
    f.IncomeTaxExpenseBenefit = f[pretaxTag]! * spec.taxRate;
    f.NetIncomeLoss = f[pretaxTag]! - f.IncomeTaxExpenseBenefit!;
    return { ...y, flows: f };
  };

  years.forEach((y, i) => {
    const fy = fyLabel(y.end);
    const qEnds = quarterEnds(y.start, y.end, spec.weekBased);
    const inProgress = i === years.length - 1;
    const isRecent = inProgress || i >= years.length - 1 - spec.quarterlyYears;

    // ---------------- 10-Qs (Q1..Q3): IS discrete 3M (+ YTD for Q2/Q3); CF YTD only; BS instant.
    if (isRecent) {
      let cumW = 0;
      for (let q = 0; q < 3; q++) {
        cumW += Q_WEIGHTS[q]!;
        const qStart = q === 0 ? y.start : addDays(qEnds[q - 1]!, 1);
        const qEnd = qEnds[q]!;
        const filed = addDays(qEnd, 35);
        if (filed > AS_OF) break;
        const filing = { accn: accn(filed), fy, fp: `Q${q + 1}`, form: "10-Q", filed };
        const isFlows = Object.fromEntries(Object.entries(y.flows).filter(([k]) => !CF_TAGS.has(k)));
        const cfFlows = Object.fromEntries(Object.entries(y.flows).filter(([k]) => CF_TAGS.has(k)));
        emitFlows(scale(isFlows, Q_WEIGHTS[q]!), qStart, qEnd, y.end, filing);
        if (q > 0) emitFlows(scale(isFlows, cumW), y.start, qEnd, y.end, filing);
        emitFlows(scale(cfFlows, cumW), y.start, qEnd, y.end, filing);
        const prev = i === 0 ? openingBs : years[i - 1]!.bs;
        const bsQ = Object.fromEntries(Object.keys(y.bs).map((k) => [k, prev[k]! + cumW * (y.bs[k]! - prev[k]!)]));
        emitBs(bsQ, qEnd, y.end, filing);
        emitBs(prev, i === 0 ? addDays(y.start, -1) : years[i - 1]!.end, y.end, filing);
      }
    }

    if (inProgress) return;

    // ---------------- 10-K: current + two prior years of flows; current + prior BS.
    const filed = addDays(y.end, 50);
    const filing = { accn: accn(filed), fy, fp: "FY", form: "10-K", filed };
    for (let k = Math.max(0, i - 2); k <= i; k++) {
      const yk = k < i ? restated(years[k]!) : years[k]!;
      // The 10-K that FIRST reports the restated year reports the original figures.
      const source = k === i ? years[k]! : yk;
      emitFlows(source.flows, source.start, source.end, source.end, filing);
    }
    emitBs(y.bs, y.end, y.end, filing);
    emitBs(i === 0 ? openingBs : years[i - 1]!.bs, i === 0 ? addDays(y.start, -1) : years[i - 1]!.end, y.end, filing);
    sink.add("dei", "EntityCommonStockSharesOutstanding", "shares", {
      end: addDays(filed, -10),
      val: round(y.flows.WeightedAverageNumberOfDilutedSharesOutstanding! * 0.985 * 1e6),
      ...filing,
    });

    // ---------------- 10-K/A restatement
    if (spec.restate && spec.restate.fyEnd === y.end) {
      const f = spec.restate.amendmentFiled;
      const amend = { accn: accn(f), fy, fp: "FY", form: "10-K/A", filed: f };
      const r = restated(y);
      emitFlows(r.flows, r.start, r.end, r.end, amend);
      emitBs(y.bs, y.end, y.end, amend);
    }
  });

  const companyfacts: CompanyFactsJson = { cik: spec.cik, entityName: spec.name, facts: sink.facts };
  const lastFyEnd = spec.fyEnds[spec.fyEnds.length - 1]!; // MMDD is the same for every year
  const profile: SubmissionsJson = {
    cik: String(spec.cik).padStart(10, "0"),
    name: spec.name,
    tickers: [spec.ticker],
    exchanges: [spec.exchange],
    sic: spec.sic,
    sicDescription: spec.sicDescription,
    fiscalYearEnd: lastFyEnd.slice(5, 7) + lastFyEnd.slice(8, 10),
    addresses: { business: { city: spec.city, stateOrCountry: spec.state, stateOrCountryDescription: spec.state } },
  };
  return {
    notice:
      "SYNTHETIC DEMONSTRATION DATA. Structure modeled on SEC EDGAR companyfacts; every numeric value is generated and is NOT the reported financial data of the named company.",
    ticker: spec.ticker,
    profile,
    companyfacts,
    demoMarket: { price: spec.price, asOf: "2026-10-02", currency: "USD", label: "Synthetic demo reference price" },
  };
}

// ---------------------------------------------------------------- company specs (synthetic parameters)
const SPECS: Spec[] = [
  {
    ticker: "DHR", cik: 313616, name: "Danaher Corporation", exchange: "NYSE",
    sic: "3826", sicDescription: "Laboratory Analytical Instruments", city: "Washington", state: "DC",
    fyEnds: ["2019-12-31", "2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31", "2026-12-31"],
    weekBased: false, quarterlyYears: 2,
    revenue0: 21000, growth: [0.2, 0.3, 0.06, -0.1, -0.01, 0.03, 0.04], grossMargin: 0.59, sgaPct: 0.3, rndPct: 0.065,
    daPct: 0.11, capexPct: 0.045, sbcPct: 0.012, taxRate: 0.17, interest: 260, shares0: 735, shareDrift: -0.003,
    cash0: 6000, debtLong: 18500, debtCurrent: 1200, goodwill: 41000, price: 214.5,
  },
  {
    ticker: "MSFT", cik: 789019, name: "Microsoft Corporation", exchange: "Nasdaq",
    sic: "7372", sicDescription: "Services-Prepackaged Software", city: "Redmond", state: "WA",
    fyEnds: ["2020-06-30", "2021-06-30", "2022-06-30", "2023-06-30", "2024-06-30", "2025-06-30", "2026-06-30", "2027-06-30"],
    weekBased: false, quarterlyYears: 2,
    revenue0: 168000, growth: [0.18, 0.18, 0.07, 0.16, 0.15, 0.14, 0.13], grossMargin: 0.69, sgaPct: 0.12, rndPct: 0.13,
    daPct: 0.09, capexPct: 0.16, sbcPct: 0.05, taxRate: 0.18, interest: 2300, shares0: 7600, shareDrift: -0.004,
    cash0: 14000, debtLong: 50000, debtCurrent: 8000, goodwill: 50000, price: 498.2,
  },
  {
    ticker: "AAPL", cik: 320193, name: "Apple Inc.", exchange: "Nasdaq",
    sic: "3571", sicDescription: "Electronic Computers", city: "Cupertino", state: "CA",
    // 52/53-week fiscal years ending on the last Saturday of September (FY2023 = 53 weeks).
    fyEnds: ["2019-09-28", "2020-09-26", "2021-09-25", "2022-09-24", "2023-09-30", "2024-09-28", "2025-09-27", "2026-09-26"],
    weekBased: true, quarterlyYears: 2, revenueTag: "RevenueFromContractWithCustomerExcludingAssessedTax",
    revenue0: 275000, growth: [0.05, 0.33, 0.08, -0.03, 0.02, 0.06, 0.05], grossMargin: 0.43, sgaPct: 0.067, rndPct: 0.075,
    daPct: 0.03, capexPct: 0.03, sbcPct: 0.03, taxRate: 0.16, interest: 2900, shares0: 17500, shareDrift: -0.03,
    cash0: 38000, debtLong: 95000, debtCurrent: 10000, goodwill: 0, price: 252.1,
  },
  {
    ticker: "NOVA", cik: 9999901, name: "Nova Analytics Inc. (fictional)", exchange: "DEMO",
    sic: "7374", sicDescription: "Services-Computer Processing & Data Preparation", city: "Austin", state: "TX",
    fyEnds: ["2019-12-31", "2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31", "2026-12-31"],
    weekBased: false, quarterlyYears: 1,
    revenue0: 1200, growth: [0.25, 0.22, 0.18, 0.15, 0.12, 0.11, 0.1], grossMargin: 0.72, sgaPct: 0.38, rndPct: null,
    daPct: 0.05, capexPct: 0.04, sbcPct: 0.06, taxRate: 0.22, interest: null, shares0: 140, shareDrift: 0.01,
    cash0: 300, debtLong: 0, debtCurrent: 0, goodwill: 150, price: 48.75,
    // Services company: never reports cost of revenue, gross profit, R&D, inventory or interest expense.
    omit: ["CostOfRevenue", "GrossProfit", "ResearchAndDevelopmentExpense", "InventoryNet", "InterestExpense", "DebtCurrent"],
    // D&A missing from the FY2023 filing cycle (simulated tagging gap).
    omitForYears: { "2023-12-31": ["DepreciationDepletionAndAmortization"] },
  },
  {
    ticker: "RSTD", cik: 9999902, name: "Restat Holdings Corp. (fictional)", exchange: "DEMO",
    sic: "3990", sicDescription: "Miscellaneous Manufacturing Industries", city: "Columbus", state: "OH",
    fyEnds: ["2019-12-31", "2020-12-31", "2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31", "2026-12-31"],
    weekBased: false, quarterlyYears: 1, revenueTag: "Revenues",
    revenue0: 5400, growth: [0.04, 0.05, 0.03, 0.02, 0.03, 0.03, 0.03], grossMargin: 0.34, sgaPct: 0.17, rndPct: 0.02,
    daPct: 0.05, capexPct: 0.05, sbcPct: 0.008, taxRate: 0.24, interest: 120, shares0: 210, shareDrift: 0,
    cash0: 600, debtLong: 2500, debtCurrent: 200, goodwill: 1800, price: 61.3,
    restate: { fyEnd: "2023-12-31", revenueFactor: 0.96, amendmentFiled: "2024-08-15" },
  },
];

mkdirSync(OUT_DIR, { recursive: true });
for (const spec of SPECS) {
  const fixture = generate(spec);
  const file = path.join(OUT_DIR, `${spec.ticker.toLowerCase()}.json`);
  writeFileSync(file, JSON.stringify(fixture) + "\n");
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
