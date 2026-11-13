/**
 * Live SEC smoke check: loads real filings for a few tickers through the production
 * pipeline and prints periods, key lines, validation issues and the default DCF.
 * Exits non-zero on load failures, validation errors, or missing core lines in the latest year.
 * Usage: SEC_USER_AGENT="App contact@example.com" npm run sec:smoke -- DHR MSFT AAPL
 */
import { getCompanyDataset } from "../src/lib/data/provider";
import { deriveModelDefaults } from "../src/lib/finance/defaults";
import { runDcf } from "../src/lib/finance/dcf";

const LINES = ["revenue", "operatingIncome", "netIncome", "epsDiluted", "dividendsPerShare", "dividendsPaid", "depreciationAmortization", "cfo", "capex", "cash", "totalDebt", "totalAssets", "totalEquity", "dilutedShares"] as const;
const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(0) + "M" : v.toFixed(2));

async function main() {
  const tickers = process.argv.slice(2);
  let failures = 0;
  for (const t of tickers.length ? tickers : ["DHR", "MSFT", "AAPL"]) {
    const r = await getCompanyDataset(t);
    if (!r.ok) {
      failures++;
      console.log(`\n=== ${t}: FAILED ${r.status} ${r.error} ${r.diagnosis ?? ""}`);
      continue;
    }
    const d = r.dataset;
    console.log(`\n=== ${t} ${d.profile.name} (CIK ${d.profile.cik}) mode=${d.meta.mode} FYE=${d.profile.fiscalYearEnd} riskFree=${d.riskFree.ok ? `${(d.riskFree.quote.rate * 100).toFixed(2)}% ${d.riskFree.quote.asOf}` : d.riskFree.reason}`);
    const a = d.annual;
    const last = a.periods.slice(-5);
    const idx = last.map((p) => a.periods.indexOf(p));
    console.log("period".padEnd(26), last.map((p) => `${p.label}(${p.start}..${p.end})`).join("  "));
    for (const l of LINES) console.log(l.padEnd(26), idx.map((i) => `${fmt(a.lines[l][i]?.value)}[${a.lines[l][i]?.status.slice(0, 3)}${a.lines[l][i]?.sources?.[0]?.tag ? ":" + a.lines[l][i]!.sources![0]!.tag.slice(0, 28) : ""}]`).join("  "));
    const q = d.quarterly;
    console.log("quarters:", q.periods.slice(-6).map((p) => `${p.key}(${p.end})`).join(" "));
    const issues = d.validation.filter((v) => v.severity !== "info");
    const lastIdx = a.periods.length - 1;
    const missingCore = (["revenue", "operatingIncome", "netIncome", "cfo", "totalAssets", "dilutedShares"] as const).filter((l) => a.lines[l][lastIdx]?.value == null);
    if (a.periods.length < 3) { failures++; console.log(`  FAIL: only ${a.periods.length} annual periods`); }
    if (missingCore.length) { failures++; console.log(`  FAIL: latest year missing ${missingCore.join(", ")}`); }
    if (d.validation.some((v) => v.severity === "error")) { failures++; console.log("  FAIL: validation errors"); }
    console.log(`validation: ${d.validation.filter((v) => v.severity === "error").length} errors, ${d.validation.filter((v) => v.severity === "warning").length} warnings, ${d.validation.filter((v) => v.severity === "info").length} info`);
    for (const v of issues.slice(0, 12)) console.log(`  ${v.severity} ${v.check} ${v.period ?? ""}: ${v.message}`);
    try {
      const def = deriveModelDefaults({ annual: a, quarterly: q, marketPrice: null, valuationDate: d.meta.valuationDate, riskFree: d.riskFree.ok ? d.riskFree.quote : null });
      const res = runDcf(def.base, def.forecast, def.valuation);
      console.log(`defaults: base FY${def.base.baseYear} growth=${(def.forecast.revenueGrowth[0]! * 100).toFixed(1)}% opm=${(def.forecast.operatingMargin[0]! * 100).toFixed(1)}% tax=${(def.forecast.taxRate[0]! * 100).toFixed(1)}% bridge=${def.bridgeAsOf}`);
      console.log(res.ok ? `DCF: WACC ${(res.wacc.applied * 100).toFixed(2)}% EV ${fmt(res.enterpriseValue)} equity ${fmt(res.equityValue)} perShare ${res.perShare.toFixed(2)}` : `DCF errors: ${res.errors.join("; ")}`);
    } catch (e) {
      failures++;
      console.log("defaults FAILED:", (e as Error).message);
    }
  }
  process.exitCode = failures ? 1 : 0;
}
main();
