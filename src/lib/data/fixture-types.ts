import type { CompanyFactsJson, SubmissionsJson } from "@/lib/sec/types";

/** A synthetic demonstration fixture. Numeric values are generated, never real. */
export interface DemoFixture {
  notice: string;
  ticker: string;
  profile: SubmissionsJson;
  companyfacts: CompanyFactsJson;
  demoMarket: { price: number; asOf: string; currency: string; label: string };
}
