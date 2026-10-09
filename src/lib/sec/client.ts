/**
 * SEC EDGAR client — server-side only.
 *
 * Compliance with SEC fair-access policy (https://www.sec.gov/os/accessing-edgar-data):
 *  - Every request declares a User-Agent with a contact email (required by SEC).
 *  - Requests are throttled below the 10 requests/second limit (default 5/s).
 *  - Responses are cached; concurrent requests for the same URL share one upstream call.
 *  - Retryable failures (429, 5xx, network) use bounded exponential backoff and honour Retry-After.
 *  - 403 is NOT retried: it signals a policy block (missing User-Agent, rate-limit lockout,
 *    or a blocked hosting IP range) that retries cannot fix and may prolong.
 *  - When the upstream fails and an expired cached copy exists, the stale copy is served
 *    and flagged so the UI can disclose its age.
 */

export const SEC_ENDPOINTS = {
  tickers: "https://www.sec.gov/files/company_tickers.json",
  submissions: (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`,
  companyFacts: (cik: string) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
};

export const padCik = (cik: number | string) => String(cik).replace(/^0+/, "").padStart(10, "0");

export class SecConfigError extends Error {
  override name = "SecConfigError";
}

export class SecHttpError extends Error {
  override name = "SecHttpError";
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly diagnosis: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface CachedResponse<T> {
  data: T;
  fetchedAt: number;
  fromCache: boolean;
  /** True when served from an expired cache entry because the upstream request failed. */
  stale: boolean;
  staleReason?: string;
}

export interface SecClientOptions {
  userAgent: string;
  maxRequestsPerSecond?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export function validateUserAgent(ua: string | undefined | null): string {
  const v = (ua ?? "").trim();
  if (!v) throw new SecConfigError("SEC_USER_AGENT is not set. SEC requires a User-Agent of the form \"<App or Company> <contact email>\".");
  if (!EMAIL.test(v)) throw new SecConfigError("SEC_USER_AGENT must include a contact email address, e.g. \"Caldun Research ops@example.com\".");
  return v;
}

export function diagnose(status: number): { diagnosis: string; retryable: boolean } {
  if (status === 403) {
    return {
      retryable: false,
      diagnosis:
        "SEC refused the request (403). Likely causes: (1) User-Agent missing or not identifying a contact; (2) a temporary lockout after exceeding 10 requests/second (wait ~10 minutes); (3) the hosting provider's egress IP range is blocked by SEC. Not retried automatically. If persistent, run ingestion from a separately hosted backend with a stable egress IP.",
    };
  }
  if (status === 404) return { retryable: false, diagnosis: "Not found on EDGAR (unknown CIK, or the company has no XBRL financial data)." };
  if (status === 429) return { retryable: true, diagnosis: "Rate limited by SEC (429); backing off." };
  if (status >= 500) return { retryable: true, diagnosis: `SEC server error (${status}); transient.` };
  return { retryable: false, diagnosis: `Unexpected HTTP ${status} from SEC.` };
}

export class SecClient {
  private readonly ua: string;
  private readonly interval: number;
  private readonly maxRetries: number;
  private readonly baseBackoff: number;
  private readonly maxBackoff: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private nextSlot = 0;
  private readonly cache = new Map<string, { data: unknown; fetchedAt: number }>();
  private readonly inflight = new Map<string, Promise<CachedResponse<unknown>>>();
  /** Upstream request count (diagnostics and tests). */
  requestCount = 0;

  constructor(opts: SecClientOptions) {
    this.ua = validateUserAgent(opts.userAgent);
    const rps = Math.min(Math.max(opts.maxRequestsPerSecond ?? 5, 0.1), 9);
    this.interval = 1000 / rps;
    this.maxRetries = opts.maxRetries ?? 3;
    this.baseBackoff = opts.baseBackoffMs ?? 1000;
    this.maxBackoff = opts.maxBackoffMs ?? 30_000;
    // Resolve global fetch per call so runtime-instrumented fetch implementations are honoured.
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Reserve the next request slot synchronously so concurrent callers are spaced correctly. */
  private async throttle() {
    const now = this.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.interval;
    if (slot > now) await this.sleep(slot - now);
  }

  async getJson<T>(url: string, ttlMs: number): Promise<CachedResponse<T>> {
    const cached = this.cache.get(url);
    if (cached && this.now() - cached.fetchedAt < ttlMs) {
      return { data: cached.data as T, fetchedAt: cached.fetchedAt, fromCache: true, stale: false };
    }
    const pending = this.inflight.get(url);
    if (pending) return pending as Promise<CachedResponse<T>>;

    const p = this.fetchWithRetry<T>(url)
      .then((data) => {
        const fetchedAt = this.now();
        this.cache.set(url, { data, fetchedAt });
        return { data, fetchedAt, fromCache: false, stale: false };
      })
      .catch((err: unknown) => {
        if (cached) {
          return { data: cached.data as T, fetchedAt: cached.fetchedAt, fromCache: true, stale: true, staleReason: err instanceof Error ? err.message : String(err) };
        }
        throw err;
      })
      .finally(() => this.inflight.delete(url));
    this.inflight.set(url, p as Promise<CachedResponse<unknown>>);
    return p;
  }

  private async fetchWithRetry<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      this.requestCount++;
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          headers: { "User-Agent": this.ua, Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
          cache: "no-store",
        });
      } catch (err) {
        if (attempt >= this.maxRetries) throw new SecHttpError(`Network error contacting SEC: ${(err as Error).message}`, 0, url, "Network failure after retries.", true);
        await this.sleep(this.backoff(attempt, null));
        continue;
      }
      if (res.ok) return (await res.json()) as T;
      const { diagnosis, retryable } = diagnose(res.status);
      if (!retryable || attempt >= this.maxRetries) {
        throw new SecHttpError(`SEC request failed with HTTP ${res.status}`, res.status, url, diagnosis, retryable);
      }
      await this.sleep(this.backoff(attempt, res.headers.get("retry-after")));
    }
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    const header = retryAfter !== null ? Number(retryAfter) * 1000 : NaN;
    const exp = this.baseBackoff * 2 ** attempt;
    return Math.min(Number.isFinite(header) && header > 0 ? Math.max(header, exp) : exp, this.maxBackoff);
  }
}

export const SEC_TTL = {
  tickers: 24 * 3600_000,
  submissions: 6 * 3600_000,
  companyFacts: 6 * 3600_000,
};
