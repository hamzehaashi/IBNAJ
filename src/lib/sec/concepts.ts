/**
 * Normalized metric catalog: maps Caldun metrics to XBRL concepts in priority order.
 *
 * Priority is resolved PER PERIOD: for each fiscal period the first tag (in order) that
 * has an observation for that exact period is used, and the chosen tag is recorded in
 * provenance. Tags are never summed implicitly.
 */

export type StatementKind = "income" | "balance" | "cashflow" | "shares";

export type MetricId =
  | "revenue"
  | "costOfRevenue"
  | "grossProfit"
  | "sga"
  | "rnd"
  | "operatingIncome"
  | "interestExpense"
  | "pretaxIncome"
  | "incomeTax"
  | "netIncome"
  | "epsDiluted"
  | "dividendsPerShare"
  | "dilutedShares"
  | "cash"
  | "shortTermInvestments"
  | "receivables"
  | "inventory"
  | "totalCurrentAssets"
  | "ppe"
  | "goodwill"
  | "intangibles"
  | "totalAssets"
  | "accountsPayable"
  | "totalCurrentLiabilities"
  | "shortTermDebt"
  | "longTermDebt"
  | "totalLiabilities"
  | "minorityInterest"
  | "totalEquity"
  | "liabilitiesAndEquity"
  | "depreciationAmortization"
  | "stockBasedComp"
  | "cfo"
  | "capex"
  | "cfi"
  | "cff"
  | "netChangeInCash"
  | "sharesOutstanding";

export interface MetricDefinition {
  id: MetricId;
  label: string;
  statement: StatementKind;
  /** duration = flow over a period; instant = point-in-time balance. */
  periodType: "duration" | "instant";
  unit: "USD" | "shares" | "USD/shares";
  /**
   * Whether quarterly values may be derived by subtraction (Q4 = FY − 9M YTD).
   * False for per-share and weighted-share metrics: EPS does not subtract.
   */
  additive: boolean;
  concepts: { taxonomy: string; tag: string }[];
  /** Sign note for display/consumers. */
  signNote?: string;
}

const g = (...tags: string[]) => tags.map((tag) => ({ taxonomy: "us-gaap", tag }));

export const METRICS: Record<MetricId, MetricDefinition> = {
  revenue: {
    id: "revenue", label: "Revenue", statement: "income", periodType: "duration", unit: "USD", additive: true,
    concepts: g(
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "Revenues",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
    ),
  },
  costOfRevenue: {
    id: "costOfRevenue", label: "Cost of revenue", statement: "income", periodType: "duration", unit: "USD", additive: true,
    concepts: g("CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"),
  },
  grossProfit: { id: "grossProfit", label: "Gross profit", statement: "income", periodType: "duration", unit: "USD", additive: true, concepts: g("GrossProfit") },
  sga: { id: "sga", label: "SG&A", statement: "income", periodType: "duration", unit: "USD", additive: true, concepts: g("SellingGeneralAndAdministrativeExpense") },
  rnd: { id: "rnd", label: "R&D", statement: "income", periodType: "duration", unit: "USD", additive: true, concepts: g("ResearchAndDevelopmentExpense") },
  operatingIncome: { id: "operatingIncome", label: "Operating income (EBIT)", statement: "income", periodType: "duration", unit: "USD", additive: true, concepts: g("OperatingIncomeLoss") },
  interestExpense: {
    id: "interestExpense", label: "Interest expense", statement: "income", periodType: "duration", unit: "USD", additive: true,
    concepts: g("InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"),
  },
  pretaxIncome: {
    id: "pretaxIncome", label: "Pretax income", statement: "income", periodType: "duration", unit: "USD", additive: true,
    concepts: g(
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    ),
  },
  incomeTax: { id: "incomeTax", label: "Income tax", statement: "income", periodType: "duration", unit: "USD", additive: true, concepts: g("IncomeTaxExpenseBenefit") },
  netIncome: { id: "netIncome", label: "Net income", statement: "income", periodType: "duration", unit: "USD", additive: true, concepts: g("NetIncomeLoss", "ProfitLoss") },
  epsDiluted: { id: "epsDiluted", label: "Diluted EPS", statement: "income", periodType: "duration", unit: "USD/shares", additive: false, concepts: g("EarningsPerShareDiluted") },
  dividendsPerShare: {
    id: "dividendsPerShare", label: "Dividends declared per share", statement: "income", periodType: "duration", unit: "USD/shares", additive: false,
    concepts: g("CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid"),
  },
  dilutedShares: {
    id: "dilutedShares", label: "Diluted weighted-average shares", statement: "shares", periodType: "duration", unit: "shares", additive: false,
    concepts: g("WeightedAverageNumberOfDilutedSharesOutstanding"),
  },
  cash: {
    id: "cash", label: "Cash & equivalents", statement: "balance", periodType: "instant", unit: "USD", additive: false,
    concepts: g("CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"),
  },
  shortTermInvestments: {
    id: "shortTermInvestments", label: "Short-term investments", statement: "balance", periodType: "instant", unit: "USD", additive: false,
    concepts: g("ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"),
  },
  receivables: { id: "receivables", label: "Accounts receivable", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("AccountsReceivableNetCurrent") },
  inventory: { id: "inventory", label: "Inventory", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("InventoryNet") },
  totalCurrentAssets: { id: "totalCurrentAssets", label: "Total current assets", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("AssetsCurrent") },
  ppe: { id: "ppe", label: "PP&E, net", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("PropertyPlantAndEquipmentNet") },
  goodwill: { id: "goodwill", label: "Goodwill", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("Goodwill") },
  intangibles: {
    id: "intangibles", label: "Intangible assets", statement: "balance", periodType: "instant", unit: "USD", additive: false,
    concepts: g("IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"),
  },
  totalAssets: { id: "totalAssets", label: "Total assets", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("Assets") },
  accountsPayable: { id: "accountsPayable", label: "Accounts payable", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("AccountsPayableCurrent") },
  totalCurrentLiabilities: { id: "totalCurrentLiabilities", label: "Total current liabilities", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("LiabilitiesCurrent") },
  shortTermDebt: {
    id: "shortTermDebt", label: "Short-term debt", statement: "balance", periodType: "instant", unit: "USD", additive: false,
    concepts: g("DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings"),
  },
  longTermDebt: {
    id: "longTermDebt", label: "Long-term debt", statement: "balance", periodType: "instant", unit: "USD", additive: false,
    concepts: g("LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations"),
  },
  totalLiabilities: { id: "totalLiabilities", label: "Total liabilities", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("Liabilities") },
  minorityInterest: { id: "minorityInterest", label: "Noncontrolling interest", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("MinorityInterest") },
  totalEquity: { id: "totalEquity", label: "Shareholders' equity", statement: "balance", periodType: "instant", unit: "USD", additive: false, concepts: g("StockholdersEquity") },
  liabilitiesAndEquity: {
    id: "liabilitiesAndEquity", label: "Total liabilities & equity", statement: "balance", periodType: "instant", unit: "USD", additive: false,
    concepts: g("LiabilitiesAndStockholdersEquity"),
  },
  depreciationAmortization: {
    id: "depreciationAmortization", label: "Depreciation & amortization", statement: "cashflow", periodType: "duration", unit: "USD", additive: true,
    concepts: g("DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet"),
  },
  stockBasedComp: { id: "stockBasedComp", label: "Stock-based compensation", statement: "cashflow", periodType: "duration", unit: "USD", additive: true, concepts: g("ShareBasedCompensation") },
  cfo: {
    id: "cfo", label: "Cash from operations", statement: "cashflow", periodType: "duration", unit: "USD", additive: true,
    concepts: g("NetCashProvidedByUsedInOperatingActivities"),
  },
  capex: {
    id: "capex", label: "Capital expenditures", statement: "cashflow", periodType: "duration", unit: "USD", additive: true,
    concepts: g("PaymentsToAcquirePropertyPlantAndEquipment"),
    signNote: "Reported as a positive payment amount; presented as a cash outflow.",
  },
  cfi: {
    id: "cfi", label: "Cash from investing", statement: "cashflow", periodType: "duration", unit: "USD", additive: true,
    concepts: g("NetCashProvidedByUsedInInvestingActivities"),
  },
  cff: {
    id: "cff", label: "Cash from financing", statement: "cashflow", periodType: "duration", unit: "USD", additive: true,
    concepts: g("NetCashProvidedByUsedInFinancingActivities"),
  },
  netChangeInCash: {
    id: "netChangeInCash", label: "Net change in cash", statement: "cashflow", periodType: "duration", unit: "USD", additive: true,
    concepts: g(
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect",
      "CashAndCashEquivalentsPeriodIncreaseDecrease",
    ),
  },
  sharesOutstanding: {
    id: "sharesOutstanding", label: "Shares outstanding (cover page)", statement: "shares", periodType: "instant", unit: "shares", additive: false,
    concepts: [{ taxonomy: "dei", tag: "EntityCommonStockSharesOutstanding" }, { taxonomy: "us-gaap", tag: "CommonStockSharesOutstanding" }],
  },
};

export const METRIC_IDS = Object.keys(METRICS) as MetricId[];
