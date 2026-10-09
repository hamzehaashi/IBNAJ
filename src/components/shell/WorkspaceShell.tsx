"use client";

import {
  BarChart3,
  BookOpen,
  Briefcase,
  Calculator,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Eye,
  FileText,
  GitCompare,
  Layers,
  LayoutDashboard,
  LineChart,
  Moon,
  Redo2,
  Save,
  Settings,
  Sun,
  Table2,
  Undo2,
  User,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useModel, useWorkspace } from "@/components/workspace/context";
import { Badge, Button, cx, Tip } from "@/components/ui/primitives";
import { downloadText, modelCsv, statementsCsv } from "@/lib/export";
import { STATEMENT_EXPORT_LINES } from "@/components/workspace/statement-layout";
import { dateLabel, usd } from "@/lib/format";
import { CompanySearch } from "./CompanySearch";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  planned?: string;
}

export function navItems(ticker: string): NavItem[] {
  const base = `/company/${encodeURIComponent(ticker)}`;
  return [
    { href: base, label: "Overview", icon: <LayoutDashboard size={16} /> },
    { href: `${base}/statements`, label: "Financial Statements", icon: <Table2 size={16} /> },
    { href: `${base}/analysis`, label: "Financial Analysis", icon: <BarChart3 size={16} /> },
    { href: `${base}/forecast`, label: "Forecasting", icon: <LineChart size={16} /> },
    { href: `${base}/dcf`, label: "DCF Valuation", icon: <Calculator size={16} /> },
    { href: `${base}/comps`, label: "Comparable Companies", icon: <GitCompare size={16} />, planned: "Phase 3" },
    { href: `${base}/scenarios`, label: "Scenarios", icon: <Layers size={16} /> },
    { href: `${base}/thesis`, label: "Investment Thesis", icon: <BookOpen size={16} />, planned: "Phase 3" },
    { href: `${base}/memo`, label: "Research Memo", icon: <FileText size={16} />, planned: "Phase 3" },
    { href: "/watchlist", label: "Watchlist", icon: <Eye size={16} />, planned: "Phase 4" },
    { href: "/portfolio", label: "Portfolio", icon: <Briefcase size={16} />, planned: "Phase 4" },
    { href: "/settings", label: "Settings", icon: <Settings size={16} /> },
  ];
}

function Sidebar({ ticker }: { ticker: string }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <nav aria-label="Workspace modules" className={cx("hidden shrink-0 flex-col border-r border-line bg-bg-2 md:flex", collapsed ? "w-14" : "w-56")}>
      <ul className="flex-1 space-y-0.5 p-2">
        {navItems(ticker).map((item) => {
          const active = pathname === item.href;
          if (item.planned) {
            return (
              <li key={item.href}>
                <span
                  aria-disabled="true"
                  title={`${item.label} — planned for ${item.planned}; not yet implemented`}
                  className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-1.5 text-fg-2/50"
                >
                  {item.icon}
                  {!collapsed && (
                    <>
                      <span className="truncate">{item.label}</span>
                      <span className="ml-auto text-[9px] uppercase tracking-wide">{item.planned}</span>
                    </>
                  )}
                </span>
              </li>
            );
          }
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={cx("flex items-center gap-2.5 rounded-md px-2.5 py-1.5", active ? "bg-card text-fg" : "text-fg-2 hover:bg-card/60 hover:text-fg")}
              >
                <span className={active ? "text-accent" : undefined}>{item.icon}</span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex items-center justify-center gap-2 border-t border-line py-2 text-fg-2 hover:text-fg" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
      </button>
    </nav>
  );
}

function MobileNav({ ticker }: { ticker: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workspace modules" className="flex gap-1 overflow-x-auto border-b border-line bg-bg-2 px-2 py-1.5 md:hidden">
      {navItems(ticker)
        .filter((i) => !i.planned)
        .map((i) => (
          <Link key={i.href} href={i.href} className={cx("shrink-0 rounded px-2 py-1 text-[12px]", pathname === i.href ? "bg-card text-fg" : "text-fg-2")}>
            {i.label}
          </Link>
        ))}
    </nav>
  );
}

const subscribeTheme = (cb: () => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
};

export function ThemeToggle() {
  const light = useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme === "light", () => false);
  const toggle = () => {
    const next = !light;
    if (next) document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("caldun-theme", next ? "light" : "dark");
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <Button onClick={toggle} aria-label={light ? "Switch to dark mode" : "Switch to light mode"} title="Toggle theme">
      {light ? <Moon size={15} /> : <Sun size={15} />}
    </Button>
  );
}

function ExportMenu() {
  const { dataset } = useWorkspace();
  const { state, result } = useModel();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const t = dataset.profile.ticker;
  const meta = { company: `${dataset.profile.name} (${t})`, source: dataset.meta.source, notice: dataset.meta.notice };
  const items = [
    { label: "Annual statements (CSV)", run: () => downloadText(`${t}-annual-statements.csv`, statementsCsv(dataset.annual, STATEMENT_EXPORT_LINES, meta)) },
    { label: "Quarterly statements (CSV)", run: () => downloadText(`${t}-quarterly-statements.csv`, statementsCsv(dataset.quarterly, STATEMENT_EXPORT_LINES, meta)) },
    ...(state && result ? [{ label: "Forecast & DCF model (CSV)", run: () => downloadText(`${t}-dcf-model.csv`, modelCsv(meta.company, state.forecast, state.valuation, result)) }] : []),
  ];
  return (
    <div ref={ref} className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)} aria-label="Export" title="Export data">
        <Download size={14} />
        <span className="hidden lg:inline">Export</span>
      </Button>
      {open && (
        <ul role="menu" className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-md border border-line bg-bg-2 shadow-xl">
          {items.map((i) => (
            <li key={i.label} role="none">
              <button
                role="menuitem"
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-card"
                onClick={() => {
                  i.run();
                  setOpen(false);
                }}
              >
                {i.label}
              </button>
            </li>
          ))}
          <li role="none" className="border-t border-line px-3 py-2 text-[11px] text-fg-2">
            Excel (.xlsx), PDF and DOCX exports arrive with the memo module (Phase 3).
          </li>
        </ul>
      )}
    </div>
  );
}

function freshness(dataset: ReturnType<typeof useWorkspace>["dataset"]) {
  if (dataset.meta.mode === "demo") return { tone: "warn" as const, label: "Demo data", tip: dataset.meta.notice ?? "Synthetic demonstration data." };
  if (dataset.meta.stale) return { tone: "warn" as const, label: "Cached · stale", tip: `Upstream unavailable; showing cached data retrieved ${new Date(dataset.meta.retrievedAt).toLocaleString()}. ${dataset.meta.staleReason ?? ""}` };
  return { tone: "pos" as const, label: "SEC filings", tip: `Retrieved ${new Date(dataset.meta.retrievedAt).toLocaleString()} from ${dataset.meta.source}.` };
}

function TopBar() {
  const { dataset } = useWorkspace();
  const { save, undo, redo, canUndo, canRedo, dirty, savedAt } = useModel();
  const m = dataset.market;
  const f = freshness(dataset);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        save();
      } else if (k === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y" && !typing) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-bg-2 px-3 py-2">
      <Link href="/" className="flex items-center gap-2 pr-1" aria-label="Caldun home">
        <span className="grid h-6 w-6 place-items-center rounded bg-accent text-[11px] font-black text-[#0b0f17]">C</span>
        <span className="hidden text-[13px] font-bold tracking-[0.25em] sm:inline">CALDUN</span>
      </Link>
      <CompanySearch />
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="num text-[15px] font-semibold text-accent">{dataset.profile.ticker}</span>
        <span className="hidden truncate text-fg-2 lg:inline">{dataset.profile.name}</span>
      </div>
      <div className="flex items-baseline gap-2">
        {m ? (
          <>
            <span className="num text-[15px] font-semibold">{usd(m.price)}</span>
            <Tip text={`${m.label}. As of ${dateLabel(m.asOf)} (${m.freshness.replace("_", "-")}, not live). Source: ${m.source}. Price change requires a licensed market-data feed (not configured).`} />
          </>
        ) : (
          <span className="text-fg-2">
            No price <Tip text="No licensed market-data provider is configured. Enter a reference price in the DCF module." />
          </span>
        )}
      </div>
      <Badge>{dataset.profile.reportingCurrency}</Badge>
      <Badge tone={f.tone} title={f.tip}>
        {f.label}
      </Badge>
      <div className="ml-auto flex items-center gap-1">
        <Button onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl/⌘+Z)">
          <Undo2 size={15} />
        </Button>
        <Button onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)">
          <Redo2 size={15} />
        </Button>
        <Button variant={dirty ? "primary" : "outline"} onClick={save} title={savedAt ? `Last saved ${new Date(savedAt).toLocaleString()} (this browser)` : "Save workspace to this browser (Ctrl/⌘+S)"}>
          <Save size={14} />
          <span className="hidden lg:inline">{dirty ? "Save" : savedAt ? "Saved" : "Save"}</span>
        </Button>
        <ExportMenu />
        <ThemeToggle />
        <span title="Local workspace — user accounts arrive in Phase 4" className="grid h-7 w-7 place-items-center rounded-full border border-line text-fg-2">
          <User size={14} aria-label="Local user" />
        </span>
      </div>
    </header>
  );
}

function DataNotices() {
  const { dataset, defaultsError } = useWorkspace();
  const errors = dataset.validation.filter((v) => v.severity === "error").length;
  const warnings = dataset.validation.filter((v) => v.severity === "warning").length;
  return (
    <>
      {dataset.meta.mode === "demo" && (
        <div role="note" className="border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-[12px] text-warn">
          <strong>Demonstration data.</strong> All figures for {dataset.profile.ticker} are synthetic fixtures, not reported financials. Configure SEC access to load filed data.
        </div>
      )}
      {(errors > 0 || warnings > 0) && (
        <div role="status" className="border-b border-line bg-bg-2 px-4 py-1 text-[11.5px] text-fg-2">
          Data checks: {errors > 0 && <span className="text-neg">{errors} error(s)</span>} {warnings > 0 && <span className="text-warn">{warnings} warning(s)</span>} — see Financial Statements → Data checks.
        </div>
      )}
      {defaultsError && (
        <div role="alert" className="border-b border-neg/30 bg-neg/10 px-4 py-1.5 text-[12px] text-neg">
          Model unavailable: {defaultsError}
        </div>
      )}
    </>
  );
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { dataset } = useWorkspace();
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <DataNotices />
      <MobileNav ticker={dataset.profile.ticker} />
      <div className="flex min-h-0 flex-1">
        <Sidebar ticker={dataset.profile.ticker} />
        <main className="min-w-0 flex-1 p-3 md:p-5">{children}</main>
      </div>
      <footer className="border-t border-line px-4 py-2 text-[11px] text-fg-2">
        Caldun provides research tools, not investment advice. Model outputs depend on analyst assumptions and may be wrong. Data: {dataset.meta.source}.
      </footer>
    </div>
  );
}
