import Link from "next/link";
import { SEC_NOT_CONFIGURED, secConfigured } from "@/lib/data/provider";
import { CompanySearch } from "@/components/shell/CompanySearch";
import { RecentCompanies } from "@/components/shell/RecentCompanies";
import { ThemeToggle } from "@/components/shell/WorkspaceShell";

export const dynamic = "force-dynamic";

export default function Home() {
  const configured = secConfigured();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded bg-accent text-[12px] font-black text-[#0b0f17]">C</span>
          <span className="text-sm font-bold tracking-[0.3em]">CALDUN</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/settings" className="text-fg-2 hover:text-fg">
            Settings
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-4 pt-[12vh]">
        <p className="text-[11px] uppercase tracking-[0.35em] text-fg-2">Investment Intelligence &amp; Financial Modeling Workspace</p>
        <h1 className="mt-3 text-center text-3xl font-semibold tracking-tight">From ticker to defensible valuation.</h1>
        <p className="mt-2 max-w-xl text-center text-fg-2">
          Financial statements from SEC filings, ratio analysis, driver-based forecasts and a DCF engine that recalculates as you change assumptions.
        </p>
        {configured ? (
          <>
            <div className="mt-8 flex w-full justify-center">
              <CompanySearch autoFocus large />
            </div>
            <p className="mt-6 text-center text-[12px] text-fg-2">
              Any SEC-registered company with XBRL financials, e.g. DHR, MSFT, AAPL. Data: SEC EDGAR filings. Share prices: entered by you (no licensed market-data feed yet).
            </p>
          </>
        ) : (
          <div role="alert" className="mt-8 w-full rounded-md border border-neg/40 bg-neg/10 px-4 py-3 text-[13px]">
            <strong className="text-neg">Company data is unavailable.</strong>
            <p className="mt-1 text-fg">{SEC_NOT_CONFIGURED}</p>
          </div>
        )}
        <RecentCompanies />
      </main>
      <footer className="border-t border-line px-5 py-3 text-[11px] text-fg-2">
        Caldun is a research tool and does not provide investment advice. Valuations are estimates that depend on user assumptions.
      </footer>
    </div>
  );
}
