import { afterEach, describe, expect, it, vi } from "vitest";
import { getRiskFreeRate, parseLatestYield, treasuryCsvUrl } from "./treasury";

// Shape of the Treasury daily par yield curve CSV (newest rows first; some tenors blank).
export const TREASURY_CSV = `Date,"1 Mo","1.5 Month","2 Mo","3 Mo","4 Mo","6 Mo","1 Yr","2 Yr","3 Yr","5 Yr","7 Yr","10 Yr","20 Yr","30 Yr"
10/08/2026,4.05,4.04,4.02,3.98,3.95,3.88,3.75,3.62,3.60,3.66,3.80,3.97,4.38,4.41
10/07/2026,4.06,4.05,4.03,3.99,3.96,3.89,3.76,3.64,3.62,3.68,3.82,3.99,4.40,4.43
10/06/2026,4.06,4.05,4.03,3.99,3.96,3.89,3.76,3.64,3.62,3.68,3.82,,4.40,4.43
`;

afterEach(() => vi.unstubAllEnvs());

describe("parseLatestYield", () => {
  it("returns the newest 10-year observation as a decimal", () => {
    expect(parseLatestYield(TREASURY_CSV)).toEqual({ asOf: "2026-10-08", rate: 0.0397, tenor: "10 Yr" });
  });

  it("locates columns by header name and ignores row order", () => {
    const reordered = `"10 Yr",Date\n3.50,01/02/2026\n3.70,01/05/2026\n`;
    expect(parseLatestYield(reordered)).toMatchObject({ asOf: "2026-01-05", rate: 0.037 });
  });

  it("skips blank values instead of treating them as zero", () => {
    const csv = `Date,"10 Yr"\n10/09/2026,\n10/08/2026,3.97\n`;
    expect(parseLatestYield(csv)).toMatchObject({ asOf: "2026-10-08", rate: 0.0397 });
  });

  it("returns null for unexpected formats", () => {
    expect(parseLatestYield("<html>error</html>")).toBeNull();
    expect(parseLatestYield(`Date,"5 Yr"\n10/08/2026,3.6\n`)).toBeNull();
  });
});

describe("getRiskFreeRate", () => {
  const now = new Date("2026-01-03T12:00:00Z");

  it("falls back to the previous year's file early in January", async () => {
    vi.stubEnv("CALDUN_DISABLE_TREASURY", "");
    const fetchImpl = vi.fn(async (url: string) =>
      url === treasuryCsvUrl(2026) ? new Response(`Date,"10 Yr"\n`, { status: 200 }) : new Response(`Date,"10 Yr"\n12/31/2025,4.10\n`, { status: 200 }),
    ) as unknown as typeof fetch;
    const r = await getRiskFreeRate({ now, fetchImpl, bypassCache: true });
    expect(r).toMatchObject({ ok: true, quote: { rate: 0.041, asOf: "2025-12-31", url: treasuryCsvUrl(2025) } });
  });

  it("reports why the rate is unavailable rather than inventing one", async () => {
    vi.stubEnv("CALDUN_DISABLE_TREASURY", "");
    const fetchImpl = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    const r = await getRiskFreeRate({ now, fetchImpl, bypassCache: true });
    expect(r).toEqual({ ok: false, reason: "Treasury returned HTTP 403." });
  });

  it("can be disabled by configuration", async () => {
    vi.stubEnv("CALDUN_DISABLE_TREASURY", "1");
    expect((await getRiskFreeRate({ bypassCache: true })).ok).toBe(false);
  });
});
