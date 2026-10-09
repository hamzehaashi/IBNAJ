import type { LineId } from "@/lib/sec/statements";

export interface StatementRow {
  line: LineId;
  /** Indented sub-line. */
  indent?: boolean;
  /** Emphasized subtotal. */
  total?: boolean;
  /** Display as an outflow (negated) — e.g. capex payments reported as positive amounts. */
  outflow?: boolean;
  /** Per-share or share-count rows are not scaled to millions. */
  kind?: "perShare" | "shares";
}

export interface StatementSection {
  id: string;
  title: string;
  /** Denominator for common-size view. */
  commonSizeBase: LineId;
  groups: { title: string; rows: StatementRow[] }[];
}

export const STATEMENTS: StatementSection[] = [
  {
    id: "income",
    title: "Income Statement",
    commonSizeBase: "revenue",
    groups: [
      {
        title: "Revenue & gross profit",
        rows: [{ line: "revenue", total: true }, { line: "costOfRevenue", indent: true }, { line: "grossProfit", total: true }],
      },
      {
        title: "Operating expenses",
        rows: [{ line: "sga", indent: true }, { line: "rnd", indent: true }, { line: "operatingIncome", total: true }, { line: "depreciationAmortization", indent: true }, { line: "ebitda", total: true }],
      },
      {
        title: "Below the line",
        rows: [{ line: "interestExpense", indent: true }, { line: "pretaxIncome" }, { line: "incomeTax", indent: true }, { line: "netIncome", total: true }],
      },
      { title: "Per share", rows: [{ line: "epsDiluted", kind: "perShare" }, { line: "dividendsPerShare", kind: "perShare" }, { line: "dilutedShares", kind: "shares" }] },
    ],
  },
  {
    id: "balance",
    title: "Balance Sheet",
    commonSizeBase: "totalAssets",
    groups: [
      {
        title: "Assets",
        rows: [
          { line: "cash", indent: true },
          { line: "shortTermInvestments", indent: true },
          { line: "receivables", indent: true },
          { line: "inventory", indent: true },
          { line: "totalCurrentAssets", total: true },
          { line: "ppe", indent: true },
          { line: "goodwill", indent: true },
          { line: "intangibles", indent: true },
          { line: "totalAssets", total: true },
        ],
      },
      {
        title: "Liabilities",
        rows: [
          { line: "accountsPayable", indent: true },
          { line: "shortTermDebt", indent: true },
          { line: "totalCurrentLiabilities", total: true },
          { line: "longTermDebt", indent: true },
          { line: "totalLiabilities", total: true },
        ],
      },
      {
        title: "Equity",
        rows: [{ line: "minorityInterest", indent: true }, { line: "totalEquity", total: true }, { line: "liabilitiesAndEquity", total: true }],
      },
      { title: "Memo", rows: [{ line: "totalDebt" }, { line: "netDebt" }, { line: "sharesOutstanding", kind: "shares" }] },
    ],
  },
  {
    id: "cashflow",
    title: "Cash Flow Statement",
    commonSizeBase: "revenue",
    groups: [
      {
        title: "Operating activities",
        rows: [
          { line: "netIncome", indent: true },
          { line: "depreciationAmortization", indent: true },
          { line: "stockBasedComp", indent: true },
          { line: "otherOperatingCashFlow", indent: true },
          { line: "cfo", total: true },
        ],
      },
      { title: "Investing activities", rows: [{ line: "capex", indent: true, outflow: true }, { line: "cfi", total: true }] },
      { title: "Financing activities", rows: [{ line: "cff", total: true }] },
      { title: "Summary", rows: [{ line: "netChangeInCash", total: true }, { line: "freeCashFlow", total: true }] },
    ],
  },
];

export const STATEMENT_EXPORT_LINES: LineId[] = [...new Set(STATEMENTS.flatMap((s) => s.groups.flatMap((g) => g.rows.map((r) => r.line))))];
