# Caldun Development Roadmap

Each phase ends with a working application and passing acceptance tests. A phase does not start
until the previous phase's core acceptance tests pass.

## Phase 0 — Audit & stabilization ✅ (this change)

- [x] Audit (repository was empty; see `AUDIT.md`)
- [x] SEC client with compliant throttling, caching, retries and 403 diagnosis
- [x] XBRL normalization: fiscal calendars, instant vs duration, YTD derivation, restatements, point-in-time
- [x] Data validation checks
- [x] Deterministic fixtures: DHR (calendar FY), MSFT (June FY), AAPL (52/53-week), NOVA (missing metrics), RSTD (restatement)
- [x] Unit, integration and E2E tests

## Phase 1 — Interactive company workspace (partially delivered)

Delivered: app shell, global search (⌘K), overview, statements (annual/quarterly, common-size,
YoY, source inspector, CSV), ratio analysis, responsive layout, dark/light themes.

Remaining:
- [ ] **Licensed market-data provider** (price, history, beta, volume, dividends). Evaluate licensing, redistribution and cost first. Unblocks the price chart (1D–MAX, crosshair, index comparison).
- [ ] Verify live SEC mode end to end from a deployment whose egress SEC accepts.
- [ ] Business description extraction from 10-K Item 1.
- [ ] TanStack Table (column resizing, virtualization) for long quarterly histories.
- [ ] Excel (.xlsx) export.

## Phase 2 — Financial modeling (core delivered)

Delivered: driver-based forecast (1–10 yrs, two margin methods with explicit priority), editable
grid with copy-forward, undo/redo and reset, calculation trace, DCF with WACC calculator, stub
period, mid-year convention, both terminal methods, editable bridge, two sensitivity matrices.

Remaining:
- [ ] Segment and volume × price revenue builds
- [ ] Treasury-stock-method dilution
- [ ] Lease and pension adjustments in the bridge; preferred-equity mapping from XBRL
- [ ] Sourced risk-free rate (e.g. Treasury yields) replacing the illustrative default

## Phase 3 — Investment research

Comparable companies (peer selection, multiples, implied valuation) · scenario probability
weighting · investment thesis editor with versioning and "potentially outdated" flags when
assumptions change · memo generator (PDF/DOCX) · full Excel model export.

## Phase 4 — Intelligence & persistence

Auth · PostgreSQL schema (users, orgs, companies, filings, raw/normalized facts, models,
scenarios, theses, memos, watchlists, holdings) · server-side saved models with version history ·
watchlist & portfolio · Caldun Intelligence (RAG over filings and the live model state, with
citations; never edits assumptions silently) · Redis cache · ingestion worker.

## Phase 5 — Commercial readiness

Billing and tier permissions · organizations · usage limits · monitoring and alerting · backups ·
security review · production deployment.

## Next priority

1. Choose a licensed market-data provider (decision needed from the product owner).
2. Deploy to Netlify and verify SEC mode. If SEC rejects the host's egress, stand up the ingestion worker described in `ARCHITECTURE.md`.
3. Comparable companies module.
