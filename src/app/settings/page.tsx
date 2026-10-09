import Link from "next/link";
import { dataMode } from "@/lib/data/provider";
import { ThemeToggle } from "@/components/shell/WorkspaceShell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default function SettingsPage() {
  const mode = dataMode();
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-10">
      <Link href="/" className="text-fg-2 hover:text-fg">
        ← Back
      </Link>
      <h1 className="text-xl font-semibold">Settings</h1>
      <section className="rounded-lg border border-line bg-card p-4">
        <h2 className="font-semibold">Appearance</h2>
        <div className="mt-2 flex items-center gap-3 text-fg-2">
          Theme <ThemeToggle />
        </div>
      </section>
      <section className="rounded-lg border border-line bg-card p-4">
        <h2 className="font-semibold">Data sources</h2>
        <dl className="mt-2 grid grid-cols-[160px_1fr] gap-y-1.5 text-[12px]">
          <dt className="text-fg-2">Mode</dt>
          <dd>{mode === "sec" ? "SEC EDGAR (live filings)" : "Demonstration (synthetic fixtures)"}</dd>
          <dt className="text-fg-2">Fundamentals</dt>
          <dd>{mode === "sec" ? "SEC XBRL companyfacts, throttled & cached server-side" : "Synthetic fixtures in SEC companyfacts format"}</dd>
          <dt className="text-fg-2">Market prices</dt>
          <dd>{mode === "sec" ? "Not configured (requires a licensed provider)" : "Synthetic demo reference prices"}</dd>
          <dt className="text-fg-2">Saved research</dt>
          <dd>Stored in this browser (localStorage). Accounts and server persistence: Phase 4.</dd>
        </dl>
      </section>
      <section className="rounded-lg border border-line bg-card p-4 text-[12px] text-fg-2">
        <h2 className="font-semibold text-fg">Keyboard shortcuts</h2>
        <ul className="mt-2 space-y-1">
          <li><kbd className="num">Ctrl/⌘ K</kbd> — focus company search</li>
          <li><kbd className="num">Ctrl/⌘ S</kbd> — save workspace</li>
          <li><kbd className="num">Ctrl/⌘ Z</kbd> / <kbd className="num">Ctrl/⌘ Shift Z</kbd> — undo / redo model changes</li>
        </ul>
      </section>
    </main>
  );
}
