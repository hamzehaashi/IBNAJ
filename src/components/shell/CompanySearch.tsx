"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/lib/data/types";
import { cx } from "@/components/ui/primitives";

/** Global ticker search. Ctrl/⌘+K focuses it from anywhere. */
export function CompanySearch({ autoFocus, large }: { autoFocus?: boolean; large?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) return; // stale results are hidden while the query is empty (see `open && q.trim()`)
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `Search failed (${r.status})`);
          return r.json() as Promise<{ results: SearchResult[] }>;
        })
        .then((d) => {
          setResults(d.results);
          setActive(0);
          setError(null);
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== "AbortError") setError((e as Error).message);
        });
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (ticker: string) => {
    setOpen(false);
    setQ("");
    router.push(`/company/${encodeURIComponent(ticker)}`);
  };

  return (
    <div className={cx("relative w-full", large ? "max-w-xl" : "max-w-sm")}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const pick = results[active]?.ticker ?? q.trim().toUpperCase();
          if (pick) go(pick);
        }}
      >
        <label className={cx("flex items-center gap-2 rounded-md border border-line bg-bg-2 px-2.5 focus-within:border-accent/70", large ? "py-3" : "py-1.5")}>
          <Search size={large ? 18 : 14} className="shrink-0 text-fg-2" aria-hidden />
          <input
            ref={inputRef}
            autoFocus={autoFocus}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Search ticker or company…"
            aria-label="Search companies by ticker or name"
            aria-autocomplete="list"
            aria-controls="company-search-results"
            className={cx("w-full bg-transparent text-fg outline-none placeholder:text-fg-2", large ? "text-base" : "text-[13px]")}
          />
          {!large && <kbd className="hidden rounded border border-line px-1 text-[10px] text-fg-2 sm:inline">⌘K</kbd>}
        </label>
      </form>
      {open && q.trim() && (
        <ul id="company-search-results" role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-line bg-bg-2 shadow-xl">
          {error && <li className="px-3 py-2 text-[12px] text-neg">{error}</li>}
          {!error && results.length === 0 && <li className="px-3 py-2 text-[12px] text-fg-2">No matches. Press Enter to try “{q.trim().toUpperCase()}”.</li>}
          {results.map((r, i) => (
            <li key={r.ticker} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(r.ticker)}
                className={cx("flex w-full items-center gap-3 px-3 py-2 text-left", i === active ? "bg-card" : "hover:bg-card")}
              >
                <span className="num w-16 font-semibold text-accent">{r.ticker}</span>
                <span className="truncate text-fg">{r.name}</span>
                {r.mode === "demo" && <span className="ml-auto text-[10px] uppercase text-warn">Demo</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
