import { afterEach, describe, expect, it, vi } from "vitest";
import dhr from "@fixtures/sec/dhr.json";
import type { TestFixture } from "@fixtures/types";
import { SEC_ENDPOINTS } from "@/lib/sec/client";
import { getCompanyDataset, normalizeTicker, searchCompanies } from "./provider";

const fixture = dhr as unknown as TestFixture;
const UA = "Caldun Test ops@example.com";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Stubbed SEC EDGAR (+ Treasury). Requires a User-Agent with a contact, like the real service. */
const routes = (status: Record<string, number> = {}) =>
  vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("home.treasury.gov")) return new Response(`Date,"10 Yr"\n10/08/2026,3.97\n`, { status: 200 });
    const ua = (init?.headers as Record<string, string> | undefined)?.["User-Agent"];
    if (!ua?.includes("@")) return new Response("{}", { status: 403 });
    for (const [frag, code] of Object.entries(status)) if (url.includes(frag)) return new Response("{}", { status: code });
    if (url.endsWith("company_tickers.json")) {
      return Response.json({
        "0": { cik_str: 313616, ticker: "DHR", title: "DANAHER CORP" },
        "1": { cik_str: 1234567, ticker: "BLKD", title: "BLOCKED CO" },
        "2": { cik_str: 7654321, ticker: "EMTY", title: "EMPTY FILER" },
        "3": { cik_str: 313616, ticker: "DHR-A", title: "DANAHER CLASS A (test)" },
      });
    }
    if (url.includes("/submissions/CIK0000313616")) return Response.json(fixture.profile);
    if (url.includes("/companyfacts/CIK0000313616")) return Response.json(fixture.companyfacts);
    if (url.includes("/submissions/CIK0007654321")) return Response.json({ ...fixture.profile, cik: "7654321", name: "EMPTY FILER" });
    if (url.includes("/companyfacts/CIK0007654321")) return Response.json({ cik: 7654321, entityName: "EMPTY FILER", facts: {} });
    return new Response("{}", { status: 404 });
  });

describe("ticker handling", () => {
  it("normalizes and validates tickers", () => {
    expect(normalizeTicker(" dhr ")).toBe("DHR");
    expect(normalizeTicker("BRK.B")).toBe("BRK.B");
    expect(normalizeTicker("../etc")).toBeNull();
    expect(normalizeTicker("")).toBeNull();
  });
});

describe("SEC is the only data source", () => {
  it("without SEC configuration returns a setup error and never falls back to fixtures", async () => {
    vi.stubEnv("SEC_USER_AGENT", "");
    const f = routes();
    vi.stubGlobal("fetch", f);
    const r = await getCompanyDataset("DHR");
    expect(r).toMatchObject({ ok: false, status: 503 });
    if (!r.ok) expect(r.diagnosis).toMatch(/SEC_USER_AGENT/);
    expect(await searchCompanies("dh")).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects invalid tickers before any network call", async () => {
    vi.stubEnv("SEC_USER_AGENT", UA);
    const f = routes();
    vi.stubGlobal("fetch", f);
    expect(await getCompanyDataset("not a ticker!")).toMatchObject({ ok: false, status: 400 });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("SEC mode (stubbed upstream)", () => {
  it("loads filings with the declared User-Agent and no provider price", async () => {
    vi.stubEnv("SEC_USER_AGENT", UA);
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
    expect(secCalls.every(([, init]) => (init?.headers as Record<string, string>)["User-Agent"] === UA)).toBe(true);
  });

  it("searches the SEC ticker list by ticker prefix and name", async () => {
    vi.stubEnv("SEC_USER_AGENT", UA);
    vi.stubGlobal("fetch", routes());
    expect((await searchCompanies("dh"))[0]!.ticker).toBe("DHR");
    expect((await searchCompanies("danaher"))[0]!.ticker).toBe("DHR");
  });

  it("surfaces a 403 with diagnosis", async () => {
    vi.stubEnv("SEC_USER_AGENT", UA);
    vi.stubGlobal("fetch", routes({ CIK0001234567: 403 }));
    const r = await getCompanyDataset("BLKD");
    expect(r).toMatchObject({ ok: false, status: 502 });
    if (!r.ok) expect(r.diagnosis).toMatch(/403|User-Agent/);
  });

  it("reports filers without XBRL financials instead of showing an empty workspace", async () => {
    vi.stubEnv("SEC_USER_AGENT", UA);
    vi.stubGlobal("fetch", routes());
    expect(await getCompanyDataset("EMTY")).toMatchObject({ ok: false, status: 422 });
  });

  it("accepts share-class tickers typed with a dot (SEC lists BRK-B)", async () => {
    vi.stubEnv("SEC_USER_AGENT", UA);
    vi.stubGlobal("fetch", routes());
    const r = await getCompanyDataset("DHR.A");
    expect(r.ok).toBe(true);
  });

  it("unknown tickers are 404", async () => {
    vi.stubEnv("SEC_USER_AGENT", UA);
    vi.stubGlobal("fetch", routes());
    expect(await getCompanyDataset("ZZZZ")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("SEC host override (tests only)", () => {
  it("accepts only a local test server", () => {
    vi.stubEnv("SEC_BASE_URL_OVERRIDE", "http://localhost:3199");
    expect(SEC_ENDPOINTS.tickers()).toBe("http://localhost:3199/files/company_tickers.json");
    vi.stubEnv("SEC_BASE_URL_OVERRIDE", "https://evil.example.com");
    expect(() => SEC_ENDPOINTS.tickers()).toThrow(/local test server/);
    vi.stubEnv("SEC_BASE_URL_OVERRIDE", "");
    expect(SEC_ENDPOINTS.companyFacts("0000313616")).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000313616.json");
  });
});
