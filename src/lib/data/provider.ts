/**
 * Company data provider — server-side only.
 *
 * Source: SEC EDGAR (companyfacts + submissions), the only data source. There is no
 * synthetic or demonstration fallback: when SEC access is not configured or fails, the
 * request fails with a diagnosis (or is served from a stale cache, flagged as such).
 *
 * Market price: none from a provider (no licensed market-data feed); the workspace uses
 * a dated price the user enters.
 */
import { buildStatementSet } from "@/lib/sec/statements";
import { validateStatements } from "@/lib/sec/validation";
import { padCik, SEC_ENDPOINTS, SEC_TTL, SecClient, SecConfigError, SecHttpError } from "@/lib/sec/client";
import type { CompanyFactsJson, CompanyTickersJson, SubmissionsJson } from "@/lib/sec/types";
import { getRiskFreeRate } from "@/lib/rates/treasury";
import type { CompanyDataset, CompanyProfile, DatasetResult, SearchResult } from "./types";

export const TICKER_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function normalizeTicker(input: string): string | null {
  const t = input.trim().toUpperCase();
  return TICKER_PATTERN.test(t) ? t : null;
}

export const SEC_NOT_CONFIGURED =
  "SEC access is not configured. Set SEC_USER_AGENT to \"<App name> <contact email>\" (SEC requires requesters to identify themselves).";

export function secConfigured(): boolean {
  return !!process.env.SEC_USER_AGENT?.trim();
}

let secClient: SecClient | null = null;
let secClientAgent: string | null = null;
function getSecClient(): SecClient {
  const ua = process.env.SEC_USER_AGENT ?? "";
  if (!secClient || secClientAgent !== ua) {
    secClient = new SecClient({ userAgent: ua, maxRequestsPerSecond: Number(process.env.SEC_MAX_RPS ?? 5) });
    secClientAgent = ua;
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

// Small in-process cache of built datasets (per server instance).
const DATASET_TTL_MS = 10 * 60_000;
const datasetCache = new Map<string, { at: number; result: DatasetResult }>();

type BaseResult = { ok: true; dataset: Omit<CompanyDataset, "riskFree"> } | Extract<DatasetResult, { ok: false }>;

export async function getCompanyDataset(rawTicker: string): Promise<DatasetResult> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return { ok: false, status: 400, error: "Invalid ticker symbol." };
  if (!secConfigured()) return { ok: false, status: 503, error: "Company data is unavailable.", diagnosis: SEC_NOT_CONFIGURED };
  const hit = datasetCache.get(ticker);
  if (hit && Date.now() - hit.at < DATASET_TTL_MS) return hit.result;
  const [base, riskFree] = await Promise.all([secDataset(ticker), getRiskFreeRate()]);
  if (!base.ok) return base;
  const result: DatasetResult = { ok: true, dataset: { ...base.dataset, riskFree } };
  // Cache only fully sourced, fresh datasets so transient failures are retried on the next request.
  if (riskFree.ok && !base.dataset.meta.stale) datasetCache.set(ticker, { at: Date.now(), result });
  return result;
}

async function resolveCik(client: SecClient, ticker: string): Promise<{ cik: string; title: string } | null> {
  const res = await client.getJson<CompanyTickersJson>(SEC_ENDPOINTS.tickers(), SEC_TTL.tickers);
  // SEC lists share classes with a hyphen (BRK-B); users often type a dot (BRK.B).
  const candidates = [ticker, ticker.replace(/\./g, "-")];
  const row = candidates.map((c) => Object.values(res.data).find((r) => r.ticker.toUpperCase() === c)).find(Boolean);
  return row ? { cik: padCik(row.cik_str), title: row.title } : null;
}

function secError(err: unknown, ticker: string): Extract<DatasetResult, { ok: false }> {
  if (err instanceof SecConfigError) return { ok: false, status: 500, error: "SEC access is misconfigured.", diagnosis: err.message };
  if (err instanceof SecHttpError) return { ok: false, status: err.status === 404 ? 404 : 502, error: err.message, diagnosis: err.diagnosis };
  console.error("[caldun] unexpected data error", { ticker, err: err instanceof Error ? err.message : String(err) });
  return { ok: false, status: 500, error: "Unexpected error while loading company data." };
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
    const annual = buildStatementSet(facts.data, "annual");
    if (annual.periods.length === 0) {
      return { ok: false, status: 422, error: `${ticker} has no annual XBRL financial data on EDGAR.`, diagnosis: "Common for funds, trusts, recent IPOs and foreign filers using IFRS (20-F/40-F), which Caldun does not map yet." };
    }
    return {
      ok: true,
      dataset: {
        profile: profileFrom(sub.data, ticker),
        annual,
        quarterly: buildStatementSet(facts.data, "quarterly"),
        validation: validateStatements(annual, facts.data),
        market: null,
        meta: {
          mode: "sec",
          source: "SEC EDGAR XBRL companyfacts",
          retrievedAt: Math.min(sub.fetchedAt, facts.fetchedAt),
          stale: sub.stale || facts.stale,
          staleReason: facts.staleReason ?? sub.staleReason,
          valuationDate: today(),
        },
      },
    };
  } catch (err) {
    return secError(err, ticker);
  }
}

export async function searchCompanies(query: string, limit = 8): Promise<SearchResult[]> {
  const q = query.trim().toUpperCase();
  if (!q || !secConfigured()) return [];
  const score = (ticker: string, name: string) => (ticker === q ? 0 : ticker.startsWith(q) ? 1 : name.toUpperCase().includes(q) ? 2 : 3);
  const res = await getSecClient().getJson<CompanyTickersJson>(SEC_ENDPOINTS.tickers(), SEC_TTL.tickers);
  return Object.values(res.data)
    .map((r) => ({ ticker: r.ticker.toUpperCase(), name: r.title, cik: padCik(r.cik_str), mode: "sec" as const }))
    .filter((r) => score(r.ticker, r.name) < 3)
    .sort((a, b) => score(a.ticker, a.name) - score(b.ticker, b.name) || a.ticker.length - b.ticker.length)
    .slice(0, limit);
}
