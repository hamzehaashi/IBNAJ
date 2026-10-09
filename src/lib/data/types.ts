import type { StatementSet } from "@/lib/sec/statements";
import type { ValidationIssue } from "@/lib/sec/validation";

export type DataMode = "demo" | "sec";

export interface CompanyProfile {
  ticker: string;
  name: string;
  cik: string;
  exchange: string | null;
  /** SEC Standard Industrial Classification description (not GICS). */
  industry: string | null;
  sic: string | null;
  headquarters: string | null;
  /** MM-DD */
  fiscalYearEnd: string | null;
  reportingCurrency: string;
  /** No licensed description source is configured yet. */
  description: string | null;
}

export interface MarketSnapshot {
  price: number;
  asOf: string;
  currency: string;
  source: string;
  /** Never "live": Caldun has no real-time feed. */
  freshness: "end_of_day" | "delayed" | "synthetic";
  label: string;
}

export interface DatasetMeta {
  mode: DataMode;
  source: string;
  /** Epoch ms when upstream data was retrieved (or fixture build time). */
  retrievedAt: number;
  stale: boolean;
  staleReason?: string;
  notice?: string;
  /** ISO date used as the default valuation date (server clock, deterministic per request). */
  valuationDate: string;
}

export interface CompanyDataset {
  profile: CompanyProfile;
  annual: StatementSet;
  quarterly: StatementSet;
  validation: ValidationIssue[];
  market: MarketSnapshot | null;
  meta: DatasetMeta;
}

export interface SearchResult {
  ticker: string;
  name: string;
  cik: string;
  mode: DataMode;
}

export type DatasetResult =
  | { ok: true; dataset: CompanyDataset }
  | { ok: false; status: number; error: string; diagnosis?: string };
