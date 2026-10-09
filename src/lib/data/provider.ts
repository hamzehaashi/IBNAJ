/**
 * Company data provider — server-side only.
 *
 * Mode selection:
 *  - SEC_USER_AGENT set → SEC EDGAR (companyfacts + submissions). Market price: none
 *    (no licensed market-data provider configured yet).
 *  - Otherwise → DEMONSTRATION mode using synthetic fixtures, labeled everywhere.
 *
 * SEC failures are reported (with diagnosis) or served from a stale cache with a flag.
 * The provider never silently substitutes demo data for a failed SEC request.
 */
import { buildStatementSet } from "@/lib/sec/statements";
import { validateStatements } from "@/lib/sec/validation";
import { padCik, SEC_ENDPOINTS, SEC_TTL, SecClient, SecConfigError, SecHttpError } from "@/lib/sec/client";
import type { CompanyFactsJson, CompanyTickersJson, SubmissionsJson } from "@/lib/sec/types";
import { getRiskFreeRate } from "@/lib/rates/treasury";
import type { DemoFixture } from "./fixture-types";
import aapl from "./fixtures/aapl.json";
import dhr from "./fixtures/dhr.json";
import msft from "./fixtures/msft.json";
import nova from "./fixtures/nova.json";
import rstd from "./fixtures/rstd.json";
import type { CompanyDataset, CompanyProfile, DataMode, DatasetResult, SearchResult } from "./types";

const FIXTURES: Record<string, DemoFixture> = Object.fromEntries(
  ([dhr, msft, aapl, nova, rstd] as unknown as DemoFixture[]).map((f) => [f.ticker, f]),
);

export const TICKER_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function normalizeTicker(input: string): string | null {
  const t = input.trim().toUpperCase();
  return TICKER_PATTERN.test(t) ? t : null;
}

export function dataMode(): DataMode {
  return process.env.SEC_USER_AGENT?.trim() ? "sec" : "demo";
}

let secClient: SecClient | null = null;
function getSecClient(): SecClient {
  if (!secClient) {
    secClient = new SecClient({
      userAgent: process.env.SEC_USER_AGENT ?? "",
      maxRequestsPerSecond: Number(process.env.SEC_MAX_RPS ?? 5),
    });
  }
  return secClient;
}

const today = () => new Date().toISOString().slice(0, 10);

function profileFrom(sub: SubmissionsJson, ticker: string): CompanyProfile {
  const addr = sub.addresses?.business;
  const fye = sub.fiscalYearEnd && /^\d{4}$/.test(sub.fiscalYearEnd) ? `${sub.fiscalYearEnd.slice(0, 2)}-${sub.fiscalYearEnd.slice(2)}` : null;
  return {
    ticker,
    name: sub.name,
    cik: padCik(sub.cik),
    exchange: sub.exchanges?.[0] ?? null,
    industry: sub.sicDescription ?? null,
    sic: sub.sic ?? null,
    headquarters: addr?.city ? `${addr.city}${addr.stateOrCountryDescription ? `, ${addr.stateOrCountryDescription}` : ""}` : null,
    fiscalYearEnd: fye,
    reportingCurrency: "USD",
    description: null,
  };
}

function buildDataset(cf: CompanyFactsJson, profile: CompanyProfile): Omit<CompanyDataset, "market" | "meta" | "riskFree"> {
  const annual = buildStatementSet(cf, "annual");
  const quarterly = buildStatementSet(cf, "quarterly");
  return { profile, annual, quarterly, validation: validateStatements(annual, cf) };
}

// Small in-process cache of built datasets (per server instance).
const DATASET_TTL_MS = 10 * 60_000;
const datasetCache = new Map<string, { at: number; result: DatasetResult }>();

export async function getCompanyDataset(rawTicker: string): Promise<DatasetResult> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return { ok: false, status: 400, error: "Invalid ticker symbol." };
  const mode = dataMode();
  const key = `${mode}:${ticker}`;
  const hit = datasetCache.get(key);
  if (hit && Date.now() - hit.at < DATASET_TTL_MS) return hit.result;
  const [base, riskFree] = await Promise.all([mode === "demo" ? demoDataset(ticker) : secDataset(ticker), getRiskFreeRate()]);
  if (!base.ok) return base;
  const result: DatasetResult = { ok: true, dataset: { ...base.dataset, riskFree } };
  // Cache only fully sourced datasets so a transient Treasury failure is retried on the next request.
  if (riskFree.ok) datasetCache.set(key, { at: Date.now(), result });
  return result;
}

type BaseResult = { ok: true; dataset: Omit<CompanyDataset, "riskFree"> } | Extract<DatasetResult, { ok: false }>;

function demoDataset(ticker: string): BaseResult {
  const f = FIXTURES[ticker];
  if (!f) {
    return {
      ok: false,
      status: 404,
      error: `${ticker} is not available in demonstration mode.`,
      diagnosis: `Demo tickers: ${Object.keys(FIXTURES).join(", ")}. Configure SEC_USER_AGENT to load SEC EDGAR data.`,
    };
  }
  const profile = profileFrom(f.profile, ticker);
  return {
    ok: true,
    dataset: {
      ...buildDataset(f.companyfacts, profile),
      market: { ...f.demoMarket, source: "Caldun demo fixture", freshness: "synthetic" },
      meta: { mode: "demo", source: "Synthetic demonstration fixture (SEC companyfacts structure)", retrievedAt: Date.parse(`${f.demoMarket.asOf}T00:00:00Z`), stale: false, notice: f.notice, valuationDate: today() },
    },
  };
}

async function resolveCik(client: SecClient, ticker: string): Promise<{ cik: string; title: string } | null> {
  const res = await client.getJson<CompanyTickersJson>(SEC_ENDPOINTS.tickers, SEC_TTL.tickers);
  const row = Object.values(res.data).find((r) => r.ticker.toUpperCase() === ticker);
  return row ? { cik: padCik(row.cik_str), title: row.title } : null;
}

async function secDataset(ticker: string): Promise<BaseResult> {
  try {
    const client = getSecClient();
    const id = await resolveCik(client, ticker);
    if (!id) return { ok: false, status: 404, error: `No SEC registrant found for ticker ${ticker}.` };
    const [sub, facts] = await Promise.all([
      client.getJson<SubmissionsJson>(SEC_ENDPOINTS.submissions(id.cik), SEC_TTL.submissions),
      client.getJson<CompanyFactsJson>(SEC_ENDPOINTS.companyFacts(id.cik), SEC_TTL.companyFacts),
    ]);
    const stale = sub.stale || facts.stale;
    return {
      ok: true,
      dataset: {
        ...buildDataset(facts.data, profileFrom(sub.data, ticker)),
        market: null,
        meta: {
          mode: "sec",
          source: "SEC EDGAR XBRL companyfacts",
          retrievedAt: Math.min(sub.fetchedAt, facts.fetchedAt),
          stale,
          staleReason: facts.staleReason ?? sub.staleReason,
          valuationDate: today(),
        },
      },
    };
  } catch (err) {
    if (err instanceof SecConfigError) return { ok: false, status: 500, error: "SEC access is misconfigured.", diagnosis: err.message };
    if (err instanceof SecHttpError) {
      return { ok: false, status: err.status === 404 ? 404 : 502, error: err.message, diagnosis: err.diagnosis };
    }
    console.error("[caldun] unexpected data error", { ticker, err: err instanceof Error ? err.message : String(err) });
    return { ok: false, status: 500, error: "Unexpected error while loading company data." };
  }
}

export async function searchCompanies(query: string, limit = 8): Promise<SearchResult[]> {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const mode = dataMode();
  const score = (ticker: string, name: string) => (ticker === q ? 0 : ticker.startsWith(q) ? 1 : name.toUpperCase().includes(q) ? 2 : 3);
  if (mode === "demo") {
    return Object.values(FIXTURES)
      .map((f) => ({ ticker: f.ticker, name: f.profile.name, cik: padCik(f.profile.cik), mode }))
      .filter((r) => score(r.ticker, r.name) < 3)
      .sort((a, b) => score(a.ticker, a.name) - score(b.ticker, b.name))
      .slice(0, limit);
  }
  const res = await getSecClient().getJson<CompanyTickersJson>(SEC_ENDPOINTS.tickers, SEC_TTL.tickers);
  return Object.values(res.data)
    .map((r) => ({ ticker: r.ticker.toUpperCase(), name: r.title, cik: padCik(r.cik_str), mode }))
    .filter((r) => score(r.ticker, r.name) < 3)
    .sort((a, b) => score(a.ticker, a.name) - score(b.ticker, b.name) || a.ticker.length - b.ticker.length)
    .slice(0, limit);
}

export function demoTickers(): { ticker: string; name: string; note: string }[] {
  const notes: Record<string, string> = {
    DHR: "Calendar fiscal year",
    MSFT: "Fiscal year ends June 30",
    AAPL: "52/53-week fiscal year",
    NOVA: "Missing metrics (fictional)",
    RSTD: "Restated financials (fictional)",
  };
  return Object.values(FIXTURES).map((f) => ({ ticker: f.ticker, name: f.profile.name, note: notes[f.ticker] ?? "" }));
}
