# Phase 0 Technical Audit — 2026-10-09

## Repository state found

`hamzehaashi/IBNAJ` had **no commits, no branches and no files** when Phase 0 began. The earlier
Caldun implementation (and its SEC HTTP 403 / rate-limiting history) is not in this repository, so
there was no existing code, data model, API or deployment configuration to preserve or refactor.

Per the brief's fallback ("if the repository is unavailable, create the initial Next.js application
foundation"), Phase 0 built a new foundation. **If the earlier Caldun codebase lives elsewhere, it
should be compared against this audit before further work.** Components worth porting would be its
data-provider integrations and any UI already validated with users.

## Environment constraints observed

| Constraint | Effect | Handling |
|---|---|---|
| `data.sec.gov` blocked by this build sandbox's egress proxy (CONNECT 403 at the proxy, not from SEC) | Live SEC calls could not be exercised during development | SEC client tested against a stubbed `fetch` that reproduces 403/429/5xx behavior; data pipeline tested on deterministic fixtures in SEC `companyfacts` format |
| No licensed market-data provider | No real prices, betas, 52-week ranges, price history | Shown as **Unavailable** with an explanation, never estimated. Demo mode uses clearly labeled synthetic reference prices |
| npm 10 arborist crashed on `vitest@4.1.11` peer resolution | Install failure | Pinned `vitest@5.0.3` (installs cleanly; no audit findings) |

## Highest-priority defects addressed (by design, since prior code was unavailable)

These defect classes were named in the brief or are common in SEC-based tools. Each has a test.

1. **SEC 403 / rate limiting** (named in the brief). The client sends a declared User-Agent, throttles to 5 req/s (SEC limit 10), caches responses, de-duplicates in-flight requests, retries only 429/5xx/network errors with bounded backoff and `Retry-After`, never retries 403, returns a diagnosis, and serves flagged stale cache during outages. `src/lib/sec/client.ts`
2. **Filing-period vs fact-period confusion.** `companyfacts` `fy`/`fp` describe the *filing*; a FY2024 10-K reports FY2022 values tagged `fy: 2024`. Periods are derived from `start`/`end` only. `src/lib/sec/xbrl.ts`
3. **Balance-sheet snapshot errors.** Instant facts are matched exactly at period end, never summed.
4. **Quarterly cash flows from YTD.** Q2/Q3 = YTD − prior YTD and Q4 = FY − 9M, using the same tag and matched period starts. EPS and share counts are never derived by subtraction.
5. **In-progress fiscal year dropped.** 10-Qs filed after the last 10-K are kept, so the newest balance sheet feeds the equity bridge. *Found by a failing test during Phase 0.*
6. **Restatements / amendments.** The latest filing wins, and the original value is retained in provenance. `asOf` gives point-in-time views.
7. **Missing data coerced to zero.** Missing values are `null` with a status (`not_reported`, `unavailable`). Any calculation with a missing required input is unavailable.

## Defects found and fixed during Phase 0 (caught by tests or validation)

| Defect | How found | Fix |
|---|---|---|
| Share counts emitted in millions, so WACC collapsed to 1.2% | Integration test (DCF refused g ≥ WACC) | Fixture generator emits absolute units; regression tests on share scale and WACC plausibility |
| Latest 10-Q data ignored | Test expecting the newest balance sheet in the bridge | Quarter detection covers the in-progress fiscal year |
| SEC client bound the global `fetch` at construction | Provider integration test | `fetch` resolved per call |
| Stray EPS facts from cash-flow-only 10-Q passes | **Data-integrity validator** flagged duplicate conflicting values | Generator fixed; validator now also reports non-numeric observations; fixtures asserted warning-free |
| Wide tables caused horizontal page scroll on phones | Screenshot audit at 390 px | `min-w-0` on grid children |

## Reusable components (new foundation)

- `src/lib/sec/*`: SEC client, tag catalog, normalization, statements, validation (framework-free)
- `src/lib/finance/*`: forecast, WACC, DCF, sensitivity, scenarios, ratios, market metrics, defaults (pure functions)
- `src/lib/data/provider.ts`: mode selection (SEC vs demo) and dataset assembly
- `src/store/workspace.ts`: per-company working state, undo/redo, save

## Known limitations (not yet addressed)

- No licensed market data: price chart, beta, 52-week range, volume and dividend yield are unavailable.
- Persistence is browser-local (localStorage). No accounts, database or server persistence (Phase 4).
- Server cache is in-process (per instance). It needs Redis or equivalent before multi-instance production.
- Tag mapping covers common US-GAAP concepts only; IFRS filers (20-F/40-F) are not mapped.
- Derived Q4 values can combine a restated annual figure with an unrestated YTD figure; the components are visible in provenance.
- EV in the overview excludes preferred equity (not yet mapped from XBRL).
- Dev-only advisory: `braces` (via `eslint-config-next` → `fast-glob`) has a high-severity advisory. It affects lint tooling only, not runtime bundles.
