"use client";

import { ArrowRightToLine, Redo2, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useModel, useWorkspace } from "@/components/workspace/context";
import { NumberCell } from "@/components/workspace/inputs";
import { Alert, Badge, Button, Card, cx, Kpi, Segmented, Tip } from "@/components/ui/primitives";
import { copyForward, FORECAST_FORMULAS, MAX_HORIZON, projectForecast, resizeAssumptions, type PerYearKey } from "@/lib/finance/forecast";
import { applyScenario } from "@/lib/finance/sensitivity";
import type { ForecastAssumptions, ForecastYear } from "@/lib/finance/types";
import { compactUsd, DASH, millions, pct, signedPct, usd } from "@/lib/format";
import type { LineId } from "@/lib/sec/statements";

type RowKind = "input" | "calc" | "output";

interface Row {
  id: string;
  label: string;
  kind: RowKind;
  /** Assumption key for input rows. */
  key?: PerYearKey;
  /** Forecast value accessor. */
  forecast?: (y: ForecastYear) => number | null;
  /** Historical value accessor (index into annual set). */
  hist?: (i: number) => number | null;
  format: "usd" | "pct";
  formula?: string;
  strong?: boolean;
}

const HIST_YEARS = 3;

export default function ForecastPage() {
  const { dataset, defaults, defaultsError } = useWorkspace();
  const { state, result, update, undo, redo, reset, canUndo, canRedo } = useModel();
  const [scenarioView, setScenarioView] = useState("base");
  const [trace, setTrace] = useState<{ row: string; year: number } | null>(null);

  const annual = dataset.annual;
  const h = (line: LineId, i: number) => annual.lines[line]?.[i]?.value ?? null;
  const ratioH = (a: LineId, b: LineId) => (i: number) => {
    const x = h(a, i), y = h(b, i);
    return x === null || y === null || y === 0 ? null : x / y;
  };
  const growthH = (i: number) => {
    const cur = h("revenue", i), prev = i > 0 ? h("revenue", i - 1) : null;
    return cur === null || prev === null || prev <= 0 ? null : cur / prev - 1;
  };
  const nwcH = (i: number) => {
    const parts = [h("receivables", i), h("inventory", i), h("accountsPayable", i)];
    if (parts.every((p) => p === null)) return null;
    return (parts[0] ?? 0) + (parts[1] ?? 0) - (parts[2] ?? 0);
  };

  const scenario = state?.scenarios.find((s) => s.id === scenarioView);
  const viewing = useMemo(() => {
    if (!defaults || !state) return null;
    if (scenarioView === "base" || !scenario) return { forecast: state.forecast, years: result?.years ?? projectForecast(defaults.base, state.forecast) };
    const adj = applyScenario({ base: defaults.base, forecast: state.forecast, valuation: state.valuation }, scenario.adjustments);
    return { forecast: adj.forecast, years: projectForecast(defaults.base, adj.forecast) };
  }, [defaults, state, result, scenarioView, scenario]);

  if (defaultsError || !defaults || !state || !viewing) {
    return <Alert tone="neg" title="Forecast unavailable">{defaultsError ?? "Loading model…"}</Alert>;
  }

  const f = viewing.forecast;
  const years = viewing.years;
  const readOnly = scenarioView !== "base";
  const lastHist = annual.periods.findIndex((p) => p.fiscalYear === defaults.base.baseYear);
  const histIdx = Array.from({ length: HIST_YEARS }, (_, k) => lastHist - (HIST_YEARS - 1) + k).filter((i) => i >= 0);
  const costBuildUp = f.marginMethod === "costBuildUp";

  const set = (key: PerYearKey, i: number, v: number) =>
    update((s) => ({ ...s, forecast: { ...s.forecast, [key]: s.forecast[key].map((x, j) => (j === i ? v : x)) } }), `${key}:${i}`);
  const setForecast = (fn: (a: ForecastAssumptions) => ForecastAssumptions) => update((s) => ({ ...s, forecast: fn(s.forecast) }));

  const rows: Row[] = [
    { id: "revenue", label: "Revenue", kind: "calc", forecast: (y) => y.revenue, hist: (i) => h("revenue", i), format: "usd", formula: FORECAST_FORMULAS.revenue, strong: true },
    { id: "revenueGrowth", label: "Revenue growth", kind: "input", key: "revenueGrowth", hist: growthH, format: "pct" },
    ...(costBuildUp
      ? ([
          { id: "grossMargin", label: "Gross margin", kind: "input", key: "grossMargin", hist: ratioH("grossProfit", "revenue"), format: "pct" },
          { id: "grossProfit", label: "Gross profit", kind: "calc", forecast: (y) => y.grossProfit, hist: (i) => h("grossProfit", i), format: "usd", formula: FORECAST_FORMULAS.grossProfit },
          { id: "sgaPct", label: "SG&A % revenue", kind: "input", key: "sgaPct", hist: ratioH("sga", "revenue"), format: "pct" },
          { id: "sga", label: "SG&A", kind: "calc", forecast: (y) => y.sga, hist: (i) => h("sga", i), format: "usd", formula: FORECAST_FORMULAS.sga },
          { id: "rndPct", label: "R&D % revenue", kind: "input", key: "rndPct", hist: ratioH("rnd", "revenue"), format: "pct" },
          { id: "rnd", label: "R&D", kind: "calc", forecast: (y) => y.rnd, hist: (i) => h("rnd", i), format: "usd", formula: FORECAST_FORMULAS.rnd },
        ] as Row[])
      : []),
    { id: "ebit", label: "EBIT (operating income)", kind: "calc", forecast: (y) => y.ebit, hist: (i) => h("operatingIncome", i), format: "usd", formula: FORECAST_FORMULAS.ebit, strong: true },
    costBuildUp
      ? { id: "ebitMargin", label: "EBIT margin (output)", kind: "output", forecast: (y) => y.ebitMargin, hist: ratioH("operatingIncome", "revenue"), format: "pct", formula: "EBIT ÷ Revenue" }
      : { id: "operatingMargin", label: "EBIT margin", kind: "input", key: "operatingMargin", hist: ratioH("operatingIncome", "revenue"), format: "pct" },
    { id: "daPct", label: "D&A % revenue", kind: "input", key: "daPct", hist: ratioH("depreciationAmortization", "revenue"), format: "pct" },
    { id: "da", label: "D&A", kind: "calc", forecast: (y) => y.da, hist: (i) => h("depreciationAmortization", i), format: "usd", formula: FORECAST_FORMULAS.da },
    { id: "ebitda", label: "EBITDA", kind: "calc", forecast: (y) => y.ebitda, hist: (i) => h("ebitda", i), format: "usd", formula: FORECAST_FORMULAS.ebitda, strong: true },
    { id: "ebitdaMargin", label: "EBITDA margin", kind: "output", forecast: (y) => y.ebitdaMargin, hist: ratioH("ebitda", "revenue"), format: "pct", formula: "EBITDA ÷ Revenue" },
    { id: "taxRate", label: "Tax rate", kind: "input", key: "taxRate", hist: ratioH("incomeTax", "pretaxIncome"), format: "pct" },
    { id: "taxes", label: "Taxes on EBIT", kind: "calc", forecast: (y) => y.taxes, format: "usd", formula: FORECAST_FORMULAS.taxes },
    { id: "nopat", label: "NOPAT", kind: "calc", forecast: (y) => y.nopat, format: "usd", formula: FORECAST_FORMULAS.nopat, strong: true },
    { id: "capexPct", label: "Capex % revenue", kind: "input", key: "capexPct", hist: ratioH("capex", "revenue"), format: "pct" },
    { id: "capex", label: "Capital expenditures", kind: "calc", forecast: (y) => y.capex, hist: (i) => h("capex", i), format: "usd", formula: FORECAST_FORMULAS.capex },
    { id: "nwcPct", label: "Operating NWC % revenue", kind: "input", key: "nwcPct", hist: (i) => { const n = nwcH(i), r = h("revenue", i); return n === null || !r ? null : n / r; }, format: "pct" },
    { id: "nwc", label: "Operating NWC", kind: "calc", forecast: (y) => y.nwc, hist: nwcH, format: "usd", formula: FORECAST_FORMULAS.nwc },
    { id: "deltaNwc", label: "Change in NWC", kind: "calc", forecast: (y) => y.deltaNwc, format: "usd", formula: FORECAST_FORMULAS.deltaNwc },
    { id: "fcff", label: "Unlevered free cash flow (FCFF)", kind: "calc", forecast: (y) => y.fcff, format: "usd", formula: FORECAST_FORMULAS.fcff, strong: true },
  ];

  const fmt = (row: Row, v: number | null) => (v === null || v === undefined ? DASH : row.format === "pct" ? pct(v) : millions(v));

  const traceText = (rowId: string, k: number): string[] => {
    const y = years[k]!;
    const prevRev = k === 0 ? defaults.base.baseRevenue : years[k - 1]!.revenue;
    const prevNwc = k === 0 ? defaults.base.baseNwc : years[k - 1]!.nwc;
    const m = (v: number) => `${millions(v)}M`;
    switch (rowId) {
      case "revenue":
        return [`${k === 0 ? `Base FY${defaults.base.baseYear} revenue (reported)` : `${years[k - 1]!.label} revenue`}: ${m(prevRev)}`, `× (1 + growth ${pct(y.revenueGrowth)})`, `= ${m(y.revenue)}`];
      case "ebit":
        return costBuildUp
          ? [`Gross profit ${m(y.grossProfit!)} − SG&A ${m(y.sga!)} − R&D ${m(y.rnd!)}`, `= ${m(y.ebit)}`]
          : [`Revenue ${m(y.revenue)} × EBIT margin ${pct(y.ebitMargin)}`, `= ${m(y.ebit)}`];
      case "taxes":
        return [`EBIT ${m(y.ebit)} × tax rate ${pct(y.taxRate)}${y.ebit <= 0 ? " (EBIT ≤ 0 → no tax)" : ""}`, `= ${m(y.taxes)}`];
      case "nopat":
        return [`EBIT ${m(y.ebit)} − taxes ${m(y.taxes)}`, `= ${m(y.nopat)}`];
      case "deltaNwc":
        return [`NWC ${m(y.nwc)} − prior NWC ${prevNwc === null ? `(base not reported; prior revenue × ${pct(f.nwcPct[k])})` : m(prevNwc)}`, `= ${m(y.deltaNwc)}`];
      case "fcff":
        return [`NOPAT ${m(y.nopat)} + D&A ${m(y.da)} − Capex ${m(y.capex)} − ΔNWC ${m(y.deltaNwc)}`, `= ${m(y.fcff)}`];
      default: {
        const row = rows.find((r) => r.id === rowId);
        const v = row?.forecast?.(y);
        return [row?.formula ?? "", `= ${v === null || v === undefined ? DASH : row!.format === "pct" ? pct(v) : m(v)}`];
      }
    }
  };

  const src = defaults.sources;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">Forecasting</h1>
        <label className="flex items-center gap-1.5 text-[12px] text-fg-2">
          Horizon
          <select
            aria-label="Forecast horizon in years"
            value={state.forecast.horizon}
            onChange={(e) => setForecast((a) => resizeAssumptions(a, Number(e.target.value)))}
            className="rounded border border-line bg-bg-2 px-1.5 py-1 text-fg"
          >
            {Array.from({ length: MAX_HORIZON }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "year" : "years"}
              </option>
            ))}
          </select>
        </label>
        <Segmented
          label="Margin method"
          value={state.forecast.marginMethod}
          onChange={(m) => setForecast((a) => ({ ...a, marginMethod: m }))}
          options={[
            { value: "operatingMargin", label: "EBIT margin" },
            { value: "costBuildUp", label: "Cost build-up" },
          ]}
        />
        <Tip text="Priority rule: exactly one method sets EBIT. 'EBIT margin' drives EBIT directly. 'Cost build-up' derives EBIT from gross margin, SG&A % and R&D %, and EBIT margin becomes an output." />
        <Segmented label="Scenario view" value={scenarioView} onChange={setScenarioView} options={state.scenarios.map((s) => ({ value: s.id, label: s.name }))} />
        <div className="ml-auto flex gap-1">
          <Button onClick={undo} disabled={!canUndo} aria-label="Undo">
            <Undo2 size={14} />
          </Button>
          <Button onClick={redo} disabled={!canRedo} aria-label="Redo">
            <Redo2 size={14} />
          </Button>
          <Button variant="outline" onClick={reset} title="Reset all assumptions to the data-derived defaults">
            <RotateCcw size={14} /> Reset to defaults
          </Button>
        </div>
      </div>
      {readOnly && <Alert tone="accent" title={`Viewing ${scenario?.name} scenario (read-only)`}>Base assumptions with this scenario&apos;s adjustments applied. Edit adjustments on the Scenarios page; switch back to Base to edit assumptions.</Alert>}

      <div className="grid gap-3 2xl:grid-cols-[1fr_320px]">
        <div className="overflow-auto rounded-lg border border-line bg-card">
          <table className="fin-table text-[12.5px]" data-testid="forecast-grid">
            <thead>
              <tr>
                <th scope="col" className="min-w-52">
                  USD millions
                </th>
                {histIdx.map((i) => (
                  <th key={i} scope="col" className="!text-fg-2">
                    {annual.periods[i]!.label}A
                  </th>
                ))}
                {years.map((y) => (
                  <th key={y.label} scope="col" className="!text-accent">
                    {y.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-row={row.id}>
                  <th scope="row" className={cx(row.strong && "font-semibold", row.kind === "input" && "text-input-fg")}>
                    <span className="flex items-center gap-1.5">
                      {row.label}
                      {row.kind === "input" && row.key && src[row.key] && (
                        <Tip text={<><Badge tone={src[row.key]!.kind === "illustrative" ? "warn" : "accent"}>{src[row.key]!.kind}</Badge> <span className="ml-1">Default: {src[row.key]!.description}</span></>} />
                      )}
                      {row.formula && <Tip text={`Formula: ${row.formula}`} />}
                    </span>
                  </th>
                  {histIdx.map((i) => (
                    <td key={i} className={cx("num text-fg-2", row.strong && "font-semibold")}>
                      {row.hist ? fmt(row, row.hist(i)) : DASH}
                    </td>
                  ))}
                  {years.map((y, k) =>
                    row.kind === "input" && row.key ? (
                      <td key={y.label} className="px-1.5">
                        <span className="group flex items-center gap-0.5">
                          <NumberCell
                            value={f[row.key][k]!}
                            onCommit={(v) => set(row.key!, k, v)}
                            label={`${row.label} ${y.label}`}
                            disabled={readOnly}
                            min={row.key === "revenueGrowth" ? -0.99 : row.key === "taxRate" ? 0 : -1}
                            max={row.key === "taxRate" ? 0.99 : 5}
                            className="w-20"
                            testId={`input-${row.key}-${k}`}
                          />
                          {k < years.length - 1 && !readOnly && (
                            <button
                              type="button"
                              onClick={() => setForecast((a) => copyForward(a, row.key!, k))}
                              title="Copy this value to all later years"
                              aria-label={`Copy ${row.label} ${y.label} to later years`}
                              className="text-fg-2 opacity-0 hover:text-accent focus:opacity-100 group-hover:opacity-100"
                            >
                              <ArrowRightToLine size={12} />
                            </button>
                          )}
                        </span>
                      </td>
                    ) : (
                      <td key={y.label} className={cx("num p-0", row.strong && "font-semibold")}>
                        <button
                          type="button"
                          data-testid={`cell-${row.id}-${k}`}
                          onClick={() => setTrace({ row: row.id, year: k })}
                          className={cx("w-full px-2.5 py-1 text-right hover:text-accent", trace?.row === row.id && trace.year === k && "outline outline-1 outline-accent", row.kind === "output" && "italic text-fg-2")}
                          title={`${row.formula ?? ""} — click to trace`}
                        >
                          {fmt(row, row.forecast?.(y) ?? null)}
                        </button>
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[11px] text-fg-2">
            <span className="text-input-fg">Blue cells</span> are editable assumptions (Enter to apply, Esc to cancel); other cells are formula-driven — click to trace. Historical columns (A) are reported or calculated from filings.
          </p>
        </div>

        <div className="space-y-3">
          <Card title="Live valuation">
            {result?.ok ? (
              <div className="grid grid-cols-2 gap-2">
                <Kpi label="Value / share" tone="valuation" value={<span data-testid="forecast-per-share">{usd(result.perShare)}</span>} />
                <Kpi label="vs reference" tone={result.upside === null ? undefined : result.upside >= 0 ? "pos" : "neg"} value={signedPct(result.upside)} />
                <Kpi label="Enterprise value" value={compactUsd(result.enterpriseValue)} />
                <Kpi label="Equity value" value={compactUsd(result.equityValue)} />
              </div>
            ) : (
              <Alert tone="neg" title="Valuation error">
                {result?.errors.join(" ")}
              </Alert>
            )}
            <Link href={`/company/${dataset.profile.ticker}/dcf`} className="mt-2 inline-block text-[12px] text-accent hover:underline">
              Open DCF model →
            </Link>
            {readOnly && <p className="mt-1 text-[11px] text-fg-2">Shows the base case. Scenario valuations are on the Scenarios page.</p>}
          </Card>
          <Card title="Calculation trace">
            {trace && years[trace.year] ? (
              <div className="space-y-1 text-[12px]" data-testid="trace">
                <div className="font-medium">
                  {rows.find((r) => r.id === trace.row)?.label} · {years[trace.year]!.label}
                </div>
                {traceText(trace.row, trace.year).map((l, i) => (
                  <div key={i} className="num whitespace-normal text-fg-2">
                    {l}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-fg-2">Click any forecast figure to see its inputs and formula.</p>
            )}
          </Card>
          <Card title="Base year">
            <dl className="grid grid-cols-2 gap-y-1 text-[12px]">
              <dt className="text-fg-2">Base fiscal year</dt>
              <dd className="num text-right">FY{defaults.base.baseYear}</dd>
              <dt className="text-fg-2">Base revenue</dt>
              <dd className="num text-right">{millions(defaults.base.baseRevenue)}M</dd>
              <dt className="text-fg-2">Base operating NWC</dt>
              <dd className="num text-right">{defaults.base.baseNwc === null ? "Not reported" : `${millions(defaults.base.baseNwc)}M`}</dd>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
