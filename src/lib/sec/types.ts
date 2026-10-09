/**
 * Shapes of SEC EDGAR JSON payloads, as served by data.sec.gov.
 *
 * IMPORTANT: In `companyfacts`, the `fy` / `fp` / `form` / `filed` fields describe
 * the FILING that contained the observation — not the period the value measures.
 * A FY2024 10-K reports FY2022 and FY2023 comparatives that all carry `fy: 2024`.
 * The measured period must always be derived from `start` / `end`.
 */

export interface RawFactObservation {
  /** Period start (duration facts only). ISO date. */
  start?: string;
  /** Period end, or the instant for balance-sheet facts. ISO date. */
  end: string;
  val: number;
  /** Accession number of the filing that reported this observation. */
  accn: string;
  /** Fiscal year of the FILING (not of the value). */
  fy: number | null;
  /** Fiscal period of the FILING (FY, Q1, Q2, Q3). */
  fp: string | null;
  form: string;
  /** Date the filing was accepted by EDGAR. ISO date. */
  filed: string;
  frame?: string;
}

export interface RawConcept {
  label?: string | null;
  description?: string | null;
  /** Keyed by unit, e.g. "USD", "shares", "USD/shares". */
  units: Record<string, RawFactObservation[]>;
}

export interface CompanyFactsJson {
  cik: number;
  entityName: string;
  /** Keyed by taxonomy ("us-gaap", "dei", "ifrs-full"), then by tag. */
  facts: Record<string, Record<string, RawConcept>>;
}

/** Subset of https://data.sec.gov/submissions/CIK##########.json that Caldun uses. */
export interface SubmissionsJson {
  cik: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  sic?: string;
  sicDescription?: string;
  /** MMDD, e.g. "1231" or "0630". */
  fiscalYearEnd?: string;
  stateOfIncorporation?: string;
  addresses?: {
    business?: { city?: string | null; stateOrCountry?: string | null; stateOrCountryDescription?: string | null };
  };
}

/** Shape of https://www.sec.gov/files/company_tickers.json */
export type CompanyTickersJson = Record<string, { cik_str: number; ticker: string; title: string }>;
