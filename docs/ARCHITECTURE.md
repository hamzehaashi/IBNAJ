# Caldun Architecture

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict, `noUncheckedIndexedAccess`) · Tailwind CSS 4 ·
Zustand · Recharts · Lucide · Vitest · Playwright.

Deferred until needed (per "do not introduce infrastructure before usage requires it"):
PostgreSQL + ORM, Redis, TanStack Query/Table, background jobs, Python services.

## Layers

```
SEC EDGAR / fixtures ──► sec/client  (throttle · cache · retry · diagnose)
                          │
                          ▼
                        sec/xbrl      raw facts → period-correct cells with provenance
                          │           (fiscal calendar, instant vs duration, YTD derivation, asOf)
                          ▼
                        sec/statements  reported lines + labeled calculated lines
                        sec/validation  identity / reconciliation / units / duplicates / signs
                          │
                          ▼
                        data/provider   CompanyDataset { profile, annual, quarterly, validation, market, meta }
                          │  (server only; in-process TTL cache)
                          ▼
  app/company/[ticker]/layout.tsx  (server) ──► WorkspaceProvider (client context)
                                                   │
                         finance/defaults ◄────────┤  data-derived starting assumptions + source labels
                         finance/dcf      ◄────────┤  ONE engine run per state change (useModel)
                         finance/sensitivity ◄─────┘  grids & scenarios re-run the same engine
```

### Single calculation path

Every module (Overview KPI, Forecasting grid, DCF page, Scenarios, sensitivity matrices, exports)
reads `runDcf(base, forecast, valuation)`. Sensitivity cells and scenarios call the same function with
modified inputs. UI components hold no formulas; they format engine outputs. That's why a change to
revenue growth on the Forecasting page shows up on the DCF page without a second implementation.

## Data integrity

| Concern | Rule |
|---|---|
| Measured period | From `start`/`end`, never from filing `fy`/`fp` |
| Fiscal year label | `fy` of the original filing for that period (filed ≤ 180 days after period end); otherwise January-end years belong to the prior year |
| Annual / quarterly | 350–380 days / 80–100 days; 52/53-week years supported |
| Balance sheet | Exact instant at period end; no summing |
| Duplicates | Latest filing wins (amendment, then accession breaks ties); original kept as `restatement` |
| Point-in-time | `asOf` hides filings accepted after the date, including fiscal years whose 10-K was not yet filed |
| Quarterly derivation | Same tag, matched start; status `derived` with formula and both sources |
| Non-additive metrics | EPS and weighted shares are never derived by subtraction |
| Missing values | `null` + status; calculations with missing required inputs are `unavailable` |
| Tag priority | Per period, first concept in `concepts.ts` order; chosen tag recorded |

## Valuation conventions (`src/lib/finance/dcf.ts`)

- FCFF = EBIT − taxes + D&A − capex − ΔNWC; taxes = EBIT × t when EBIT > 0 (no NOL modeling).
- Stub period: year 1 counts only the fraction after the valuation date; t_i = stub + (i − 1).
- Mid-year: each flow is discounted at the midpoint of its own period; the perpetuity TV is discounted at t_N − 0.5 (its flows are also mid-year); the exit-multiple TV is discounted at t_N.
- Equity = EV + cash + short-term investments + non-operating assets − total debt − NCI − preferred.
- Shares: latest diluted weighted average (treasury-stock dilution at the current price is not recomputed).
- Validation: g ≥ WACC, WACC ≤ 0, shares ≤ 0, horizon outside 1–10, non-numeric inputs and debt weight ≥ 100% are errors. Terminal share of EV > 85%, g > 4% and negative equity are warnings.
- Margin priority: exactly one of `operatingMargin` or `costBuildUp` determines EBIT.

## SEC access and the 403 problem

The client (`src/lib/sec/client.ts`) is the only path to SEC and runs server-side only.

- `SEC_USER_AGENT` must contain a contact email; without it, Caldun runs in labeled demo mode and makes no SEC calls.
- 403 is never retried automatically. It returns a diagnosis: missing User-Agent, a lockout after exceeding 10 req/s, or a blocked hosting IP range.
- **If the deployment host's egress is blocked by SEC** (common with shared serverless IP pools), move ingestion to a small separately hosted worker with a stable egress IP. That worker writes normalized datasets to Postgres or object storage, and the web app reads from there. The provider interface (`getCompanyDataset`) is the seam for that change.

## Security

- Provider keys and the SEC User-Agent are server-side environment variables; nothing is exposed to the browser.
- Ticker input is validated against `^[A-Z][A-Z0-9.\-]{0,9}$` before any upstream call; search queries are length-limited.
- Response headers: `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`.
- Not yet implemented: authentication, authorization, rate limiting of Caldun's own API, audit logging (Phases 4–5).

## Persistence (current)

Browser `localStorage` (`caldun-workspace`, versioned) stores explicitly saved model states per
ticker plus recently viewed companies. Working state lives in memory, supports undo/redo, and warns
before unload when unsaved.
