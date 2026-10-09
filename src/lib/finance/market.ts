/**
 * Market-value metrics derived from a reference price and the latest reported data.
 * Each metric returns null with a reason when an input is unavailable.
 */
import type { LineId, StatementSet } from "@/lib/sec/statements";

export interface Derived {
  value: number | null;
  formula: string;
  basis?: string;
  reason?: string;
}

export interface MarketMetrics {
  sharesOutstanding: Derived;
  marketCap: Derived;
  enterpriseValue: Derived;
  pe: Derived;
  evEbitda: Derived;
  dividendYield: Derived;
}

function latest(set: StatementSet, line: LineId): { value: number; label: string; end: string } | null {
  for (let i = set.periods.length - 1; i >= 0; i--) {
    const v = set.lines[line]?.[i]?.value;
    if (v !== null && v !== undefined) return { value: v, label: set.periods[i]!.label, end: set.periods[i]!.end };
  }
  return null;
}

export function marketMetrics(price: number | null, annual: StatementSet, quarterly: StatementSet): MarketMetrics {
  // Prefer the most recent balance sheet (quarterly when newer than annual).
  const bs = (line: LineId) => {
    const a = latest(annual, line);
    const q = latest(quarterly, line);
    return q && (!a || q.end > a.end) ? q : a;
  };
  const sharesCover = bs("sharesOutstanding");
  const sharesDiluted = latest(annual, "dilutedShares");
  const shares = sharesCover ?? sharesDiluted;
  const sharesOutstanding: Derived = shares
    ? { value: shares.value, formula: sharesCover ? "Cover-page shares outstanding" : "Diluted weighted-average shares", basis: shares.label }
    : { value: null, formula: "Shares outstanding", reason: "No share count reported." };

  const noPrice = "No reference price available.";
  const marketCap: Derived =
    price === null ? { value: null, formula: "Price × shares outstanding", reason: noPrice }
    : !shares ? { value: null, formula: "Price × shares outstanding", reason: "No share count reported." }
    : { value: price * shares.value, formula: "Price × shares outstanding", basis: shares.label };

  const debt = bs("totalDebt");
  const cash = bs("cash");
  const sti = bs("shortTermInvestments");
  const mi = bs("minorityInterest");
  const evFormula = "Market cap + Total debt + Noncontrolling interest − Cash − Short-term investments";
  const enterpriseValue: Derived =
    marketCap.value === null ? { value: null, formula: evFormula, reason: marketCap.reason }
    : !cash ? { value: null, formula: evFormula, reason: "Cash not reported." }
    : {
        value: marketCap.value + (debt?.value ?? 0) + (mi?.value ?? 0) - cash.value - (sti?.value ?? 0),
        formula: evFormula,
        basis: `Balance sheet ${cash.label}${!debt ? "; debt not reported (excluded)" : ""}${!mi ? "; NCI not reported (excluded)" : ""}`,
      };

  const eps = latest(annual, "epsDiluted");
  const pe: Derived =
    price === null ? { value: null, formula: "Price ÷ diluted EPS (latest fiscal year)", reason: noPrice }
    : !eps ? { value: null, formula: "Price ÷ diluted EPS (latest fiscal year)", reason: "Diluted EPS not reported." }
    : eps.value <= 0 ? { value: null, formula: "Price ÷ diluted EPS (latest fiscal year)", reason: "Not meaningful: EPS is zero or negative." }
    : { value: price / eps.value, formula: "Price ÷ diluted EPS (latest fiscal year)", basis: eps.label };

  const ebitda = latest(annual, "ebitda");
  const evEbitda: Derived =
    enterpriseValue.value === null ? { value: null, formula: "EV ÷ EBITDA (latest fiscal year)", reason: enterpriseValue.reason }
    : !ebitda ? { value: null, formula: "EV ÷ EBITDA (latest fiscal year)", reason: "EBITDA unavailable." }
    : ebitda.value <= 0 ? { value: null, formula: "EV ÷ EBITDA (latest fiscal year)", reason: "Not meaningful: EBITDA is zero or negative." }
    : { value: enterpriseValue.value / ebitda.value, formula: "EV ÷ EBITDA (latest fiscal year)", basis: ebitda.label };

  const dpsFormula = "Dividends declared per share (latest fiscal year) ÷ price";
  const dps = latest(annual, "dividendsPerShare");
  const lastAnnual = annual.periods[annual.periods.length - 1];
  const dividendYield: Derived =
    price === null ? { value: null, formula: dpsFormula, reason: noPrice }
    : !dps ? { value: null, formula: dpsFormula, reason: "No dividends per share reported in filings (the company may not pay a dividend)." }
    : dps.label !== lastAnnual?.label ? { value: null, formula: dpsFormula, reason: `Latest reported dividend is for ${dps.label}, not the latest fiscal year; not treated as current.` }
    : { value: dps.value / price, formula: dpsFormula, basis: `${dps.label} dividends of $${dps.value.toFixed(2)}/share` };

  return { sharesOutstanding, marketCap, enterpriseValue, pe, evEbitda, dividendYield };
}
