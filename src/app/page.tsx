import Link from "next/link";
import { dataMode, demoTickers } from "@/lib/data/provider";
import { CompanySearch } from "@/components/shell/CompanySearch";
import { RecentCompanies } from "@/components/shell/RecentCompanies";
import { ThemeToggle } from "@/components/shell/WorkspaceShell";

export const dynamic = "force-dynamic";

export default function Home() {
  const mode = dataMode();
  const demos = mode === "demo" ? demoTickers() : [];
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
          Filing-sourced financial statements, ratio analysis, driver-based forecasts and a DCF engine that recalculates as you change assumptions.
        </p>
        <div className="mt-8 flex w-full justify-center">
          <CompanySearch autoFocus large />
        </div>
        {mode === "demo" ? (
          <section className="mt-10 w-full" aria-labelledby="demo-heading">
            <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
              <strong>Demonstration mode.</strong> SEC access is not configured, so Caldun is using synthetic fixtures that mirror SEC reporting
              structures. Figures are not the companies&apos; reported financials. Set <code className="num">SEC_USER_AGENT</code> to load EDGAR data.
            </div>
            <h2 id="demo-heading" className="mt-6 text-[11px] uppercase tracking-wide text-fg-2">
              Demo companies
            </h2>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {demos.map((d) => (
                <li key={d.ticker}>
                  <Link href={`/company/${d.ticker}`} className="flex items-center gap-3 rounded-md border border-line bg-card px-3 py-2.5 hover:border-accent/60">
                    <span className="num w-12 font-semibold text-accent">{d.ticker}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{d.name}</span>
                      <span className="block text-[11px] text-fg-2">{d.note}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="mt-6 text-[12px] text-fg-2">Data source: SEC EDGAR XBRL filings. Market prices require a licensed provider (not yet configured).</p>
        )}
        <RecentCompanies />
      </main>
      <footer className="border-t border-line px-5 py-3 text-[11px] text-fg-2">
        Caldun is a research tool and does not provide investment advice. Valuations are estimates that depend on user assumptions.
      </footer>
    </div>
  );
}
