"use client";

import { ChevronDown, ChevronRight, Download, X } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { useWorkspace } from "@/components/workspace/context";
import { STATEMENTS, type StatementRow } from "@/components/workspace/statement-layout";
import { Badge, Button, Card, cx, EmptyState, Segmented } from "@/components/ui/primitives";
import { downloadText, lineLabel, statementsCsv } from "@/lib/export";
import { dateLabel, DASH, millions, pct, signedPct, usd } from "@/lib/format";
import type { Cell, FiscalPeriod } from "@/lib/sec/xbrl";
import type { LineId, StatementSet } from "@/lib/sec/statements";
import { METRICS, type MetricId } from "@/lib/sec/concepts";

type Tab = "income" | "balance" | "cashflow" | "checks";
type View = "values" | "common" | "yoy";

const STATUS_LABEL: Record<Cell["status"], string> = {
  reported: "Reported",
  derived: "Derived from filings",
  calculated: "Calculated",
  not_reported: "Not reported",
  not_applicable: "Not applicable",
  unavailable: "Calculation unavailable",
};

function priorIndex(set: StatementSet, i: number): number {
  const p = set.periods[i]!;
  if (p.kind === "annual") return i - 1;
  return set.periods.findIndex((q) => q.fiscalYear === p.fiscalYear - 1 && q.fiscalQuarter === p.fiscalQuarter);
}

function formatCell(row: StatementRow, cell: Cell | undefined, view: View, set: StatementSet, i: number, base: LineId): string {
  if (!cell || cell.value === null) return DASH;
  if (view === "yoy") {
    const j = priorIndex(set, i);
    const prev = j >= 0 ? set.lines[row.line][j]?.value : null;
    if (prev === null || prev === undefined || prev === 0) return DASH;
    return signedPct((cell.value - prev) / Math.abs(prev));
  }
  if (view === "common") {
    if (row.kind) return DASH;
    const d = set.lines[base][i]?.value;
    return d ? pct(cell.value / d) : DASH;
  }
  if (row.kind === "perShare") return usd(cell.value);
  if (row.kind === "shares") return `${millions(cell.value)}M`;
  return millions(row.outflow ? -cell.value : cell.value);
}

function Inspector({ line, period, cell, onClose }: { line: LineId; period: FiscalPeriod; cell: Cell; onClose: () => void }) {
  const def = line in METRICS ? METRICS[line as MetricId] : null;
  return (
    <aside aria-label="Value inspector" className="rounded-lg border border-accent/40 bg-card p-4 text-[12px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{lineLabel(line)}</div>
          <div className="text-fg-2">
            {period.label} · {period.kind === "annual" || def?.periodType === "duration" ? `${period.start} to ${period.end}` : `as of ${period.end}`}
          </div>
        </div>
        <Button onClick={onClose} aria-label="Close inspector">
          <X size={14} />
        </Button>
      </div>
      <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1">
        <dt className="text-fg-2">Value</dt>
        <dd className="num">{cell.value === null ? DASH : cell.value.toLocaleString("en-US")} {def ? def.unit : "USD"}</dd>
        <dt className="text-fg-2">Status</dt>
        <dd>{STATUS_LABEL[cell.status]}</dd>
        {cell.formula && (
          <>
            <dt className="text-fg-2">Formula</dt>
            <dd>{cell.formula}</dd>
          </>
        )}
        {cell.note && (
          <>
            <dt className="text-fg-2">Note</dt>
            <dd>{cell.note}</dd>
          </>
        )}
        {def?.signNote && (
          <>
            <dt className="text-fg-2">Sign</dt>
            <dd>{def.signNote}</dd>
          </>
        )}
        {cell.restatement && (
          <>
            <dt className="text-warn">Restated</dt>
            <dd>
              Originally <span className="num">{cell.restatement.originalValue.toLocaleString("en-US")}</span> ({cell.restatement.originalForm} filed {cell.restatement.originalFiled})
            </dd>
          </>
        )}
      </dl>
      {cell.sources && cell.sources.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] uppercase tracking-wide text-fg-2">Source observations</div>
          <ul className="mt-1 space-y-2">
            {cell.sources.map((s, k) => (
              <li key={k} className="rounded border border-line p-2">
                <div className="num break-all text-accent">
                  {s.taxonomy}:{s.tag}
                </div>
                <div className="num">
                  {s.value.toLocaleString("en-US")} {s.unit}
                </div>
                <div className="text-fg-2">
                  {s.start ? `${s.start} → ${s.end}` : `Instant ${s.end}`} · {s.form} · filed {s.filed}
                </div>
                <div className="num text-fg-2">accn {s.accn}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

function ChecksPanel() {
  const { dataset } = useWorkspace();
  const issues = dataset.validation;
  if (issues.length === 0) return <EmptyState title="All data checks passed">Balance-sheet identity, cash reconciliation, period durations, units, signs and duplicates were checked.</EmptyState>;
  const order = { error: 0, warning: 1, info: 2 };
  return (
    <ul className="space-y-1.5">
      {[...issues].sort((a, b) => order[a.severity] - order[b.severity]).map((i) => (
        <li key={i.id} className="flex flex-wrap items-baseline gap-2 rounded border border-line px-3 py-1.5">
          <Badge tone={i.severity === "error" ? "neg" : i.severity === "warning" ? "warn" : "neutral"}>{i.severity}</Badge>
          <span className="font-medium">{i.check}</span>
          {i.period && <span className="text-fg-2">{i.period}</span>}
          <span className="basis-full text-fg-2 sm:basis-auto">{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

export default function StatementsPage() {
  const { dataset } = useWorkspace();
  const [tab, setTab] = useState<Tab>("income");
  const [freq, setFreq] = useState<"annual" | "quarterly">("annual");
  const [view, setView] = useState<View>("values");
  const [count, setCount] = useState<"5" | "8" | "all">("5");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<{ line: LineId; i: number } | null>(null);

  const set = freq === "annual" ? dataset.annual : dataset.quarterly;
  const section = STATEMENTS.find((s) => s.id === tab);
  const indices = useMemo(() => {
    const all = set.periods.map((_, i) => i);
    return count === "all" ? all : all.slice(-Number(count));
  }, [set, count]);

  const exportCurrent = () => {
    if (!section) return;
    const lines = section.groups.flatMap((g) => g.rows.map((r) => r.line));
    const sliced: StatementSet = {
      ...set,
      periods: indices.map((i) => set.periods[i]!),
      lines: Object.fromEntries(Object.entries(set.lines).map(([k, v]) => [k, indices.map((i) => v[i]!)])) as StatementSet["lines"],
    };
    downloadText(`${dataset.profile.ticker}-${section.id}-${freq}.csv`, statementsCsv(sliced, lines, { company: `${dataset.profile.name} (${dataset.profile.ticker})`, source: dataset.meta.source, notice: dataset.meta.notice }));
  };

  const selCell = selected ? set.lines[selected.line]?.[selected.i] : undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">Financial Statements</h1>
        <Segmented
          label="Statement"
          value={tab}
          onChange={(t) => {
            setTab(t);
            setSelected(null);
          }}
          options={[
            { value: "income", label: "Income" },
            { value: "balance", label: "Balance sheet" },
            { value: "cashflow", label: "Cash flow" },
            { value: "checks", label: `Data checks (${dataset.validation.length})` },
          ]}
        />
      </div>
      {tab !== "checks" && (
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label="Frequency"
            value={freq}
            onChange={(f) => {
              setFreq(f);
              setSelected(null);
            }}
            options={[
              { value: "annual", label: "Annual" },
              { value: "quarterly", label: "Quarterly" },
            ]}
          />
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: "values", label: "Values" },
              { value: "common", label: "Common-size" },
              { value: "yoy", label: "YoY growth" },
            ]}
          />
          <Segmented
            label="Periods"
            value={count}
            onChange={setCount}
            options={[
              { value: "5", label: "Last 5" },
              { value: "8", label: "Last 8" },
              { value: "all", label: "All" },
            ]}
          />
          <Button variant="outline" onClick={exportCurrent}>
            <Download size={14} /> CSV
          </Button>
          <span className="text-[11px] text-fg-2">
            {view === "values" ? "USD millions except per-share; negatives in parentheses." : view === "common" ? `% of ${section?.commonSizeBase === "totalAssets" ? "total assets" : "revenue"}.` : freq === "annual" ? "vs. prior fiscal year." : "vs. same quarter of the prior fiscal year."}
          </span>
        </div>
      )}

      {tab === "checks" ? (
        <Card title="Data integrity checks">
          <ChecksPanel />
        </Card>
      ) : set.periods.length === 0 ? (
        <EmptyState title={`No ${freq} periods available`}>{freq === "quarterly" ? "No complete set of quarterly filings was found." : "No annual filings with financial data were found."}</EmptyState>
      ) : (
        <div className="grid gap-3 2xl:grid-cols-[1fr_340px]">
          <div className="overflow-auto rounded-lg border border-line bg-card" style={{ maxHeight: "calc(100vh - 220px)" }}>
            <table className="fin-table text-[12.5px]">
              <thead>
                <tr>
                  <th scope="col" className="min-w-56">
                    {section?.title}
                  </th>
                  {indices.map((i) => (
                    <th key={i} scope="col" title={`${set.periods[i]!.start} to ${set.periods[i]!.end}`}>
                      <div>{set.periods[i]!.label}</div>
                      <div className="text-[10px] font-normal">{dateLabel(set.periods[i]!.end)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section?.groups.map((g) => {
                  const key = `${section.id}:${g.title}`;
                  const isCollapsed = collapsed[key];
                  return (
                    <Fragment key={key}>
                      <tr>
                        <th colSpan={indices.length + 1} scope="colgroup" className="!bg-bg-2">
                          <button type="button" className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-fg-2 hover:text-fg" aria-expanded={!isCollapsed} onClick={() => setCollapsed((c) => ({ ...c, [key]: !c[key] }))}>
                            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                            {g.title}
                          </button>
                        </th>
                      </tr>
                      {!isCollapsed &&
                        g.rows.map((row) => (
                          <tr key={row.line}>
                            <th scope="row" className={cx(row.indent && "pl-6", row.total && "font-semibold")}>
                              {lineLabel(row.line)}
                              {row.outflow && <span className="ml-1 text-[10px] text-fg-2">(outflow)</span>}
                            </th>
                            {indices.map((i) => {
                              const cell = set.lines[row.line]?.[i];
                              const text = formatCell(row, cell, view, set, i, section.commonSizeBase);
                              const isSel = selected?.line === row.line && selected.i === i;
                              return (
                                <td key={i} className={cx("num p-0", row.total && "font-semibold")}>
                                  <button
                                    type="button"
                                    onClick={() => setSelected({ line: row.line, i })}
                                    title={cell ? `${STATUS_LABEL[cell.status]}${cell.note ? ` — ${cell.note}` : ""}` : undefined}
                                    className={cx(
                                      "w-full px-2.5 py-1 text-right",
                                      cell?.status === "calculated" && "italic text-fg-2",
                                      cell?.status === "derived" && "italic",
                                      (cell?.value ?? null) === null && "text-fg-2/60",
                                      isSel && "outline outline-1 outline-accent",
                                    )}
                                  >
                                    {text}
                                    {cell?.restatement && <sup className="ml-0.5 text-warn">R</sup>}
                                    {cell?.status === "derived" && <sup className="ml-0.5 text-accent">d</sup>}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="space-y-2">
            {selected && selCell ? (
              <Inspector line={selected.line} period={set.periods[selected.i]!} cell={selCell} onClose={() => setSelected(null)} />
            ) : (
              <div className="rounded-lg border border-dashed border-line p-4 text-[12px] text-fg-2">Select any figure to inspect its XBRL source, filing, period and formula.</div>
            )}
            <div className="rounded-lg border border-line p-3 text-[11px] text-fg-2">
              <div>
                <span className="italic text-fg-2">Italic grey</span> = calculated by Caldun
              </div>
              <div>
                <sup className="text-accent">d</sup> = derived from cumulative (YTD) filings
              </div>
              <div>
                <sup className="text-warn">R</sup> = restated by a later filing
              </div>
              <div>— = not reported or not calculable (select for reason)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
