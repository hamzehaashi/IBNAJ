import { afterEach, describe, expect, it, vi } from "vitest";
import dhr from "./fixtures/dhr.json";
import type { DemoFixture } from "./fixture-types";
import { getCompanyDataset, normalizeTicker, searchCompanies } from "./provider";

const fixture = dhr as unknown as DemoFixture;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ticker handling", () => {
  it("normalizes and validates tickers", () => {
    expect(normalizeTicker(" dhr ")).toBe("DHR");
    expect(normalizeTicker("BRK.B")).toBe("BRK.B");
    expect(normalizeTicker("../etc")).toBeNull();
    expect(normalizeTicker("")).toBeNull();
  });
});

describe("demo mode", () => {
  it("loads a labeled synthetic dataset", async () => {
    vi.stubEnv("SEC_USER_AGENT", "");
    const r = await getCompanyDataset("dhr");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dataset.meta.mode).toBe("demo");
    expect(r.dataset.meta.notice).toMatch(/SYNTHETIC/);
    expect(r.dataset.market?.freshness).toBe("synthetic");
    expect(r.dataset.profile).toMatchObject({ ticker: "DHR", cik: "0000313616", fiscalYearEnd: "12-31" });
    expect(r.dataset.annual.periods.length).toBe(6);
    expect(r.dataset.riskFree.ok).toBe(false); // disabled in tests; the model falls back to an illustrative rate
  });

  it("returns 404 with guidance for tickers without fixtures, and 400 for invalid input", async () => {
    vi.stubEnv("SEC_USER_AGENT", "");
    const r = await getCompanyDataset("ZZZZ");
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(await getCompanyDataset("not a ticker!")).toMatchObject({ ok: false, status: 400 });
  });

  it("searches by ticker prefix and name", async () => {
    vi.stubEnv("SEC_USER_AGENT", "");
    expect((await searchCompanies("dh"))[0]!.ticker).toBe("DHR");
    expect((await searchCompanies("microsoft"))[0]!.ticker).toBe("MSFT");
  });
});

describe("SEC mode (stubbed upstream)", () => {
  const routes = (status: Record<string, number> = {}) =>
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("home.treasury.gov")) return new Response(`Date,"10 Yr"\n10/08/2026,3.97\n`, { status: 200 });
      const ua = (init?.headers as Record<string, string> | undefined)?.["User-Agent"];
      if (!ua?.includes("@")) return new Response("{}", { status: 403 });
      for (const [frag, code] of Object.entries(status)) if (url.includes(frag)) return new Response("{}", { status: code });
      if (url.endsWith("company_tickers.json")) {
        return Response.json({ "0": { cik_str: 313616, ticker: "DHR", title: "DANAHER CORP" }, "1": { cik_str: 1234567, ticker: "BLKD", title: "BLOCKED CO" } });
      }
      if (url.includes("/submissions/CIK0000313616")) return Response.json(fixture.profile);
      if (url.includes("/companyfacts/CIK0000313616")) return Response.json(fixture.companyfacts);
      return new Response("{}", { status: 404 });
    });

  it("loads SEC data with no market price (no licensed provider) and never labels it demo", async () => {
    vi.stubEnv("SEC_USER_AGENT", "Caldun Test ops@example.com");
    vi.stubEnv("CALDUN_DISABLE_TREASURY", "");
    const f = routes();
    vi.stubGlobal("fetch", f);
    const r = await getCompanyDataset("DHR");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dataset.meta.mode).toBe("sec");
    expect(r.dataset.market).toBeNull();
    expect(r.dataset.riskFree).toMatchObject({ ok: true, quote: { rate: 0.0397, asOf: "2026-10-08" } });
    expect(r.dataset.annual.periods.at(-1)!.key).toBe("FY2025");
    const secCalls = f.mock.calls.filter(([url]) => !String(url).includes("home.treasury.gov"));
    expect(secCalls.length).toBeGreaterThan(0);
    expect(secCalls.every(([, init]) => (init?.headers as Record<string, string>)["User-Agent"] === "Caldun Test ops@example.com")).toBe(true);
  });

  it("surfaces a 403 with diagnosis and does not substitute demo data", async () => {
    vi.stubEnv("SEC_USER_AGENT", "Caldun Test ops@example.com");
    vi.stubGlobal("fetch", routes({ "CIK0001234567": 403 }));
    const r = await getCompanyDataset("BLKD");
    expect(r).toMatchObject({ ok: false, status: 502 });
    if (!r.ok) expect(r.diagnosis).toMatch(/403|User-Agent/);
  });
});
