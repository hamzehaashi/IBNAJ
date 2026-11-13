import type { CompanyFactsJson, SubmissionsJson } from "../../src/lib/sec/types";

/**
 * TEST-ONLY fixture in SEC EDGAR payload shapes. Numeric values are generated and are not
 * any company's reported financials. Never imported by application code.
 */
export interface TestFixture {
  notice: string;
  ticker: string;
  profile: SubmissionsJson;
  companyfacts: CompanyFactsJson;
}
