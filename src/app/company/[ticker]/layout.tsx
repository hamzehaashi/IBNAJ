import type { Metadata } from "next";
import Link from "next/link";
import { getCompanyDataset } from "@/lib/data/provider";
import { WorkspaceProvider } from "@/components/workspace/context";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  return { title: decodeURIComponent(ticker).toUpperCase() };
}

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const result = await getCompanyDataset(decodeURIComponent(ticker));
  if (!result.ok) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-[11px] uppercase tracking-[0.3em] text-fg-2">Caldun</div>
        <h1 className="text-lg font-semibold">Unable to load {decodeURIComponent(ticker).toUpperCase()}</h1>
        <p className="text-fg">{result.error}</p>
        {result.diagnosis && <p className="text-[12px] text-fg-2">{result.diagnosis}</p>}
        <Link href="/" className="mt-2 rounded-md border border-line px-3 py-1.5 hover:border-accent/60">
          Back to search
        </Link>
      </main>
    );
  }
  return (
    <WorkspaceProvider dataset={result.dataset}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}
