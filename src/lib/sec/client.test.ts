import { describe, expect, it } from "vitest";
import { padCik, SecClient, SecConfigError, SecHttpError, validateUserAgent } from "./client";

const UA = "Caldun Test ops@example.com";

function harness(responses: (() => Response | Promise<Response>)[], opts: { sleepAdvancesClock?: boolean } = {}) {
  const advanceOnSleep = opts.sleepAdvancesClock ?? true;
  let t = 0;
  const calls: { url: string; at: number; headers: Record<string, string> }[] = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, at: t, headers: init?.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  }) as unknown as typeof fetch;
  const client = new SecClient({
    userAgent: UA,
    maxRequestsPerSecond: 5,
    fetchImpl,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      if (advanceOnSleep) t += ms;
    },
    baseBackoffMs: 100,
  });
  return { client, calls, sleeps, advance: (ms: number) => (t += ms) };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => () => new Response(JSON.stringify(body), { status, headers });

describe("SecClient", () => {
  it("requires a User-Agent with a contact email", () => {
    expect(() => validateUserAgent("")).toThrow(SecConfigError);
    expect(() => validateUserAgent("Caldun")).toThrow(/contact email/);
    expect(validateUserAgent(UA)).toBe(UA);
  });

  it("sends the declared User-Agent header", async () => {
    const h = harness([json({ ok: 1 })]);
    await h.client.getJson("https://data.sec.gov/x", 1000);
    expect(h.calls[0]!.headers["User-Agent"]).toBe(UA);
  });

  it("throttles concurrent requests to the configured rate (5/s → 200 ms slots)", async () => {
    // Clock frozen at t=0: each concurrent caller must wait for its own reserved slot.
    const h = harness([json(1), json(2), json(3)], { sleepAdvancesClock: false });
    await Promise.all(["a", "b", "c"].map((u) => h.client.getJson(`https://data.sec.gov/${u}`, 1000)));
    expect(h.sleeps).toEqual([200, 400]);
  });

  it("caches and de-duplicates concurrent requests", async () => {
    const h = harness([json({ v: 1 })]);
    const [a, b] = await Promise.all([h.client.getJson("https://data.sec.gov/f", 10_000), h.client.getJson("https://data.sec.gov/f", 10_000)]);
    expect(a.data).toEqual({ v: 1 });
    expect(b.data).toEqual({ v: 1 });
    const c = await h.client.getJson("https://data.sec.gov/f", 10_000);
    expect(c.fromCache).toBe(true);
    expect(h.client.requestCount).toBe(1);
  });

  it("retries 503 with exponential backoff, then succeeds", async () => {
    const h = harness([json({}, 503), json({}, 503), json({ v: 2 })]);
    const r = await h.client.getJson<{ v: number }>("https://data.sec.gov/r", 1000);
    expect(r.data.v).toBe(2);
    expect(h.client.requestCount).toBe(3);
    // backoff 100 → throttle wait 100 (next 200 ms slot) → backoff 200 → slot already free.
    expect(h.sleeps).toEqual([100, 100, 200]);
  });

  it("honours Retry-After on 429", async () => {
    const h = harness([json({}, 429, { "retry-after": "2" }), json({ v: 3 })]);
    await h.client.getJson("https://data.sec.gov/r", 1000);
    expect(h.sleeps).toContain(2000);
  });

  it("does not retry 403 and returns a diagnosis", async () => {
    const h = harness([json({}, 403), json({ v: 1 })]);
    const err = await h.client.getJson("https://data.sec.gov/blocked", 1000).catch((e) => e);
    expect(err).toBeInstanceOf(SecHttpError);
    expect((err as SecHttpError).status).toBe(403);
    expect((err as SecHttpError).retryable).toBe(false);
    expect((err as SecHttpError).diagnosis).toMatch(/User-Agent/);
    expect(h.client.requestCount).toBe(1);
  });

  it("gives up after bounded retries", async () => {
    const h = harness([json({}, 500), json({}, 500), json({}, 500), json({}, 500), json({}, 500)]);
    await expect(h.client.getJson("https://data.sec.gov/down", 1000)).rejects.toBeInstanceOf(SecHttpError);
    expect(h.client.requestCount).toBe(4); // initial + 3 retries
  });

  it("serves a stale cached copy, flagged, when the upstream fails after expiry", async () => {
    const h = harness([json({ v: "old" }), json({}, 403)]);
    await h.client.getJson("https://data.sec.gov/s", 1000);
    h.advance(5000);
    const r = await h.client.getJson<{ v: string }>("https://data.sec.gov/s", 1000);
    expect(r).toMatchObject({ stale: true, fromCache: true, data: { v: "old" } });
    expect(r.staleReason).toMatch(/403/);
  });

  it("pads CIKs to ten digits", () => {
    expect(padCik(313616)).toBe("0000313616");
    expect(padCik("0000789019")).toBe("0000789019");
  });
});
