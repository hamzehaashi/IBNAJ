/**
 * U.S. Treasury daily par yield curve — public-domain data from home.treasury.gov.
 * Used as the sourced risk-free rate in the WACC (10-year tenor by default).
 *
 * CSV format (one file per calendar year, newest rows first):
 *   Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"
 *   10/08/2026,4.12,...,4.31,...
 * Values are percentages. Columns are located by header name, not position.
 */

export interface RiskFreeQuote {
  /** Decimal rate, e.g. 0.0431. */
  rate: number;
  /** ISO date of the observation. */
  asOf: string;
  tenor: string;
  source: string;
  url: string;
}

export const TREASURY_SOURCE = "U.S. Department of the Treasury, Daily Par Yield Curve Rates";
export const DEFAULT_TENOR = "10 Yr";

export const treasuryCsvUrl = (year: number) =>
  `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** MM/DD/YYYY → YYYY-MM-DD; null if malformed. */
function isoFromUs(d: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d);
  return m ? `${m[3]}-${m[1]!.padStart(2, "0")}-${m[2]!.padStart(2, "0")}` : null;
}

/** Latest observation for `tenor` in a Treasury par-yield CSV. Rows with a blank tenor value are skipped, never zero-filled. */
export function parseLatestYield(csv: string, tenor = DEFAULT_TENOR, year?: number): Omit<RiskFreeQuote, "source" | "url"> | null {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const header = splitCsvLine(lines[0]!);
  const dateCol = header.findIndex((h) => h.toLowerCase() === "date");
  const tenorCol = header.indexOf(tenor);
  if (dateCol < 0 || tenorCol < 0) return null;
  let best: { asOf: string; rate: number } | null = null;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const asOf = isoFromUs(cells[dateCol] ?? "");
    const raw = cells[tenorCol] ?? "";
    if (!asOf || raw === "" || (year !== undefined && !asOf.startsWith(String(year)))) continue;
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct < -5 || pct > 30) continue;
    // Published to two decimals in percent; round to remove binary floating-point noise from the ÷100.
    if (!best || asOf > best.asOf) best = { asOf, rate: Number((pct / 100).toFixed(6)) };
  }
  return best ? { ...best, tenor } : null;
}

export type RiskFreeResult = { ok: true; quote: RiskFreeQuote } | { ok: false; reason: string };

const TTL_MS = 6 * 3600_000;
const FAILURE_TTL_MS = 10 * 60_000;
let cache: { at: number; result: RiskFreeResult } | null = null;

/** Fetch the latest 10-year par yield (server-side), trying the current then the previous year. Cached in-process. */
export async function getRiskFreeRate(opts: { now?: Date; fetchImpl?: typeof fetch; timeoutMs?: number; bypassCache?: boolean } = {}): Promise<RiskFreeResult> {
  if (process.env.CALDUN_DISABLE_TREASURY === "1") return { ok: false, reason: "Treasury rate lookup disabled by configuration." };
  const now = opts.now ?? new Date();
  if (!opts.bypassCache && cache && now.getTime() - cache.at < (cache.result.ok ? TTL_MS : FAILURE_TTL_MS)) return cache.result;
  const doFetch = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const year = now.getUTCFullYear();
  let reason = "No observations found.";
  for (const y of [year, year - 1]) {
    const url = treasuryCsvUrl(y);
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 5000), cache: "no-store" });
      if (!res.ok) {
        reason = `Treasury returned HTTP ${res.status}.`;
        continue;
      }
      const parsed = parseLatestYield(await res.text(), DEFAULT_TENOR, y);
      if (parsed) {
        const result: RiskFreeResult = { ok: true, quote: { ...parsed, source: TREASURY_SOURCE, url } };
        cache = { at: now.getTime(), result };
        return result;
      }
    } catch (err) {
      reason = `Treasury rate unavailable: ${err instanceof Error ? err.message : String(err)}.`;
    }
  }
  const result: RiskFreeResult = { ok: false, reason };
  cache = { at: now.getTime(), result };
  return result;
}
