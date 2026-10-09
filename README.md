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

Without configuration, Caldun runs in **demonstration mode**. It uses synthetic fixtures in SEC
`companyfacts` format (DHR, MSFT, AAPL, NOVA, RSTD), labeled as synthetic throughout the UI. They are
**not** the companies' reported financials.

To load SEC EDGAR data, set a User-Agent that identifies you (required by SEC):

```bash
cp .env.example .env.local
# SEC_USER_AGENT="Your App Name you@example.com"
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Unit + integration tests (Vitest) |
| `npm run test:e2e` | End-to-end workflow tests (Playwright; builds must exist: `npm run build` first) |
| `npm run lint` / `typecheck` | ESLint / TypeScript |
| `npm run fixtures` | Regenerate the deterministic demo fixtures |

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
