# Caldun

**Investment Intelligence & Financial Modeling Workspace.** Enter a ticker to get filing-sourced
financial statements, ratio analysis, a driver-based forecast and a DCF valuation that recalculates
as you change assumptions.

> Caldun is a research tool, not investment advice. Valuations depend on user assumptions.

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

All company data comes from **SEC EDGAR** filings. There is no demo or synthetic data in the
app. SEC requires every requester to identify itself, so set a User-Agent with a contact email:

```bash
cp .env.example .env.local
# SEC_USER_AGENT="Your App Name you@example.com"
```

Without it, Caldun shows a setup message rather than any data. Share prices are not provided by
a data feed: enter a dated price per company in the app (it is labeled "User-entered").

Behind an HTTPS proxy (some cloud dev containers), Node's built-in `fetch` needs
`NODE_USE_ENV_PROXY=1` (Node ≥ 22.21) to reach SEC.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit + integration tests (Vitest) |
| `npm run test:e2e` | End-to-end workflow tests (Playwright; run `npm run build` first). Uses a local mock of the SEC endpoints serving the test fixtures |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
| `npm run fixtures` | Regenerate the deterministic **test-only** fixtures (`tests/fixtures/sec`) |
| `npm run sec:smoke -- DHR MSFT` | Load real SEC filings through the pipeline and fail on validation errors or missing core lines |

## Modules

| Module | Status |
|---|---|
| Overview, Financial Statements, Financial Analysis | ✅ (price chart needs a licensed market-data provider) |
| Forecasting, DCF Valuation, Scenarios & sensitivity | ✅ |
| Comparable Companies, Investment Thesis, Research Memo | Phase 3 |
| Watchlist, Portfolio, accounts, Caldun Intelligence | Phase 4 |

## Documentation

- [`docs/AUDIT.md`](docs/AUDIT.md): Phase 0 audit, defects found and fixed, limitations
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): layers, data-integrity rules, valuation conventions, SEC access
- [`docs/ROADMAP.md`](docs/ROADMAP.md): phased plan and next priorities
