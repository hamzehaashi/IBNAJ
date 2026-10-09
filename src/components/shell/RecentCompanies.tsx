"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWorkspaceStore } from "@/store/workspace";

export function RecentCompanies() {
  const [ready, setReady] = useState(false);
  const recent = useWorkspaceStore((s) => s.recent);
  const saved = useWorkspaceStore((s) => s.saved);
  useEffect(() => {
    Promise.resolve(useWorkspaceStore.persist.rehydrate()).finally(() => setReady(true));
  }, []);
  if (!ready || recent.length === 0) return null;
  return (
    <section className="mt-8 w-full" aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="text-[11px] uppercase tracking-wide text-fg-2">
        Recently viewed
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {recent.map((t) => (
          <li key={t}>
            <Link href={`/company/${t}`} className="num inline-flex items-center gap-2 rounded border border-line px-2.5 py-1 hover:border-accent/60">
              {t}
              {saved[t] && <span className="text-[10px] text-pos">saved</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
