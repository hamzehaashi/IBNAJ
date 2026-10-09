"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useWorkspace } from "@/components/workspace/context";
import { Badge, Card, cx, Segmented, Tip } from "@/components/ui/primitives";
import { cagr } from "@/lib/finance/forecast";
import { computeRatios, RATIO_CATEGORIES, type RatioCategory, type RatioFormat, type RatioSeries } from "@/lib/finance/ratios";
import { compactUsd, days, DASH, multiple, pct, ratio } from "@/lib/format";

const fmt = (f: RatioFormat, v: number | null) =>
  v === null ? DASH : f === "pct" ? pct(v) : f === "multiple" ? multiple(v) : f === "days" ? days(v) : f === "currency" ? compactUsd(v) : ratio(v);

/** Flag notable period-over-period moves (thresholds are display heuristics, not judgments). */
function significant(s: RatioSeries, i: number): string | null {
  const cur = s.points[i]?.value ?? null;
  const prev = s.points[i - 1]?.value ?? null;
  if (cur === null || prev === null) return null;
  if (s.format === "pct") return Math.abs(cur - prev) >= 0.03 ? `${cur > prev ? "+" : "−"}${(Math.abs(cur - prev) * 100).toFixed(1)} pp vs prior` : null;
  if (s.format === "currency") return null;
  const rel = prev !== 0 ? (cur - prev) / Math.abs(prev) : 0;
  return Math.abs(rel) >= 0.2 ? `${rel > 0 ? "+" : "−"}${Math.abs(rel * 100).toFixed(0)}% vs prior` : null;
}

export default function AnalysisPage() {
  const { dataset } = useWorkspace();
  const [freq, setFreq] = useState<"annual" | "quarterly">("annual");
  const set = freq === "annual" ? dataset.annual : dataset.quarterly;
  const ratios = useMemo(() => computeRatios(set), [set]);
  const [category, setCategory] = useState<RatioCategory>("Profitability");
  const [selectedId, setSelectedId] = useState("operatingMargin");
  const selected = ratios.find((r) => r.id === selectedId) ?? ratios[0]!;
  const visible = set.periods.map((_, i) => i).slice(freq === "annual" ? -6 : -8);

  const annual = dataset.annual;
  const revIdx = annual.periods.map((_, i) => i).filter((i) => annual.lines.revenue[i]?.value != null);
  const lastRev = revIdx.at(-1);
  const revCagr = (n: number) => {
    if (lastRev === undefined || lastRev - n < 0) return null;
    return cagr(annual.lines.revenue[lastRev - n]?.value ?? null, annual.lines.revenue[lastRev]!.value, n);
  };

  const chartData = visible.map((i) => ({ period: set.periods[i]!.label, value: selected.points[i]?.value ?? null }));
  const scale = selected.format === "pct" ? 100 : selected.format === "currency" ? 1e-6 : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">Financial Analysis</h1>
        <Segmented label="Frequency" value={freq} onChange={setFreq} options={[{ value: "annual", label: "Annual" }, { value: "quarterly", label: "Quarterly" }]} />
        <Segmented label="Category" value={category} onChange={setCategory} options={RATIO_CATEGORIES.map((c) => ({ value: c, label: c }))} />
      </div>
      {freq === "quarterly" && <p className="text-[11px] text-warn">Quarterly flow ratios use single-quarter values (not annualized); turnover and return ratios are therefore not comparable to annual figures.</p>}

      <div className="grid gap-3 xl:grid-cols-[1fr_420px]">
        <div className="overflow-auto rounded-lg border border-line bg-card">
          <table className="fin-table text-[12.5px]">
            <thead>
              <tr>
                <th scope="col" className="min-w-56">
                  {category}
                </th>
                {visible.map((i) => (
                  <th key={i} scope="col">
                    {set.periods[i]!.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ratios
                .filter((r) => r.category === category)
                .map((r) => (
                  <tr key={r.id} className={cx(r.id === selected.id && "[&>*]:!bg-accent/10")}>
                    <th scope="row">
                      <button type="button" onClick={() => setSelectedId(r.id)} className="flex items-center gap-1 text-left hover:text-accent">
                        {r.label}
                      </button>
                    </th>
                    {visible.map((i) => {
                      const p = r.points[i]!;
                      const flag = significant(r, i);
                      return (
                        <td key={i} className="num" title={p.value === null ? p.reason : (flag ?? undefined)}>
                          <span className={cx(p.value === null && "text-fg-2/60")}>{fmt(r.format, p.value)}</span>
                          {flag && <span className="ml-1 text-warn" aria-label={flag}>●</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-fg-2">Select a ratio for its trend and formula. <span className="text-warn">●</span> marks large moves vs the prior period (≥3 pp for percentages, ≥20% otherwise). Hover “—” for the reason a value is unavailable.</p>
        </div>

        <div className="space-y-3">
          <Card title={selected.label} actions={<Badge>{selected.category}</Badge>}>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData.map((d) => ({ ...d, value: d.value === null ? null : d.value * scale }))} margin={{ top: 6, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="period" stroke="var(--text-2)" fontSize={10} />
                  <YAxis stroke="var(--text-2)" fontSize={10} />
                  <Tooltip
                    contentStyle={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                    formatter={(v) => fmt(selected.format, Number(v) / scale)}
                  />
                  <Line dataKey="value" name={selected.label} stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 rounded border border-line bg-bg-2 px-3 py-2 text-[12px]">
              <div className="text-[10px] uppercase tracking-wide text-fg-2">Formula</div>
              {selected.formula}
            </div>
          </Card>

          <Card title="Revenue CAGR">
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[1, 3, 5].map((n) => (
                <div key={n} className="rounded border border-line py-2">
                  <dt className="text-[11px] text-fg-2">{n}-year</dt>
                  <dd className="num text-base font-semibold">{pct(revCagr(n))}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[11px] text-fg-2">
              Through {lastRev !== undefined ? annual.periods[lastRev]!.label : DASH}. (End ÷ Start)^(1/n) − 1 on reported annual revenue.
            </p>
          </Card>

          <Card title="Peer comparison">
            <p className="text-[12px] text-fg-2">
              Peer benchmarks will come from the Comparable Companies module (Phase 3). Caldun does not show industry averages it cannot source. <Tip text="Peer metrics require consistently normalized data for each selected comparable company." />
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
