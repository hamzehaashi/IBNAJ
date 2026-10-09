"use client";

import { useMemo } from "react";
import { useModel, useWorkspace } from "@/components/workspace/context";
import { NumberCell, SliderField } from "@/components/workspace/inputs";
import { SensitivityTable } from "@/components/workspace/SensitivityTable";
import { Alert, Badge, Card, Kpi, Segmented, Tip } from "@/components/ui/primitives";
import type { AssumptionSource } from "@/lib/finance/defaults";
import type { PerYearKey } from "@/lib/finance/forecast";
import type { BridgeInputs, ForecastYear, ValuationAssumptions, WaccInputs } from "@/lib/finance/types";
import { computeWacc } from "@/lib/finance/wacc";
import { compactUsd, millions, multiple, pct, signedPct, usd } from "@/lib/format";

function SourceBadge({ s }: { s?: AssumptionSource }) {
  if (!s) return null;
  const tone = s.kind === "illustrative" ? "warn" : s.kind === "market" ? "valuation" : "accent";
  return (
    <span title={s.description}>
      <Badge tone={tone}>{s.kind === "illustrative" ? "assumption" : s.kind}</Badge>
    </span>
  );
}

const uniform = (xs: number[]) => xs.every((x) => Math.abs(x - xs[0]!) < 1e-12);

export default function DcfPage() {
  const { dataset, defaults, defaultsError } = useWorkspace();
  const { state, result, update } = useModel();
  const inputs = useMemo(() => (defaults && state ? { base: defaults.base, forecast: state.forecast, valuation: state.valuation } : null), [defaults, state]);

  if (defaultsError || !defaults || !state || !result || !inputs) {
    return <Alert tone="neg" title="DCF unavailable">{defaultsError ?? "Loading model…"}</Alert>;
  }
  const v = state.valuation;
  const f = state.forecast;
  const src = defaults.sources;
  const computed = computeWacc(v.wacc);

  const setV = (fn: (x: ValuationAssumptions) => ValuationAssumptions, tag?: string) => update((s) => ({ ...s, valuation: fn(s.valuation) }), tag);
  const setW = (k: keyof WaccInputs) => (x: number) => setV((val) => ({ ...val, wacc: { ...val.wacc, [k]: x } }), `wacc.${k}`);
  const setB = (k: keyof BridgeInputs) => (x: number) => setV((val) => ({ ...val, bridge: { ...val.bridge, [k]: x } }), `bridge.${k}`);
  const setAll = (key: PerYearKey) => (x: number) => update((s) => ({ ...s, forecast: { ...s.forecast, [key]: s.forecast[key].map(() => x) } }), `all.${key}`);
  const marginKey: PerYearKey = f.marginMethod === "operatingMargin" ? "operatingMargin" : "grossMargin";
  const n = f.horizon;
  const mixed = (key: PerYearKey) => (!uniform(f[key].slice(0, n)) ? " Years currently differ; moving the slider sets all years." : "");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">DCF Valuation</h1>
        <Badge>Unlevered FCF</Badge>
        <span className="text-[11px] text-fg-2">Valuation date {dataset.meta.valuationDate} · bridge balance sheet {defaults.bridgeAsOf}</span>
      </div>

      {!result.ok && (
        <Alert tone="neg" title="Invalid model configuration">
          <ul className="list-disc pl-4" data-testid="dcf-errors">
            {result.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      {result.ok && result.warnings.length > 0 && (
        <Alert tone="warn" title="Review">
          <ul className="list-disc pl-4">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Enterprise value" value={result.ok ? compactUsd(result.enterpriseValue) : "—"} tip="Sum of PV(FCFF) + PV(terminal value)." />
        <Kpi label="Equity value" value={result.ok ? compactUsd(result.equityValue) : "—"} tip="Enterprise value adjusted by the bridge items below." />
        <Kpi label="Fair value / share" tone="valuation" value={<span data-testid="dcf-per-share">{result.ok ? usd(result.perShare) : "—"}</span>} tip="Equity value ÷ diluted shares." />
        <div className="rounded-lg border border-line bg-card px-4 py-3">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-fg-2">
            Reference price <SourceBadge s={src.referencePrice} />
          </div>
          <NumberCell value={v.referencePrice ?? Number.NaN} onCommit={(x) => setV((val) => ({ ...val, referencePrice: x }))} scale={1} decimals={2} suffix="$" label="Reference share price" min={0.01} className="mt-1 w-28" testId="reference-price" />
        </div>
        <Kpi label="Implied upside" tone={result.ok && result.upside !== null ? (result.upside >= 0 ? "pos" : "neg") : undefined} value={result.ok ? signedPct(result.upside) : "—"} sub={v.referencePrice === null ? "Enter a reference price" : undefined} />
        <Kpi label="Terminal value share" value={result.ok ? pct(result.terminalShareOfEv, 0) : "—"} tip="PV of terminal value ÷ enterprise value." />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <Card title="WACC" actions={<span className="num text-valuation" data-testid="wacc-value">{pct(result.ok ? result.wacc.applied : (v.waccOverride ?? computed.wacc), 2)}</span>}>
          <div className="space-y-2.5">
            {(
              [
                ["riskFreeRate", "Risk-free rate", 0, 0.1, 0.0005, "Yield on long-term government bonds."],
                ["beta", "Beta", 0, 3, 0.01, "Sensitivity of the stock to market returns (CAPM)."],
                ["equityRiskPremium", "Equity risk premium", 0, 0.12, 0.0005, "Expected market return above the risk-free rate."],
                ["preTaxCostOfDebt", "Pre-tax cost of debt", 0, 0.15, 0.0005, "Yield the company pays on new borrowing."],
                ["marginalTaxRate", "Marginal tax rate", 0, 0.5, 0.005, "Tax rate applied to the interest tax shield."],
                ["debtWeight", "Debt / (debt + equity)", 0, 0.9, 0.005, "Target capital structure weight of debt."],
              ] as const
            ).map(([k, label, min, max, step, tip]) => (
              <div key={k}>
                <div className="mb-0.5 flex items-center gap-1.5 text-[11px]">
                  <Tip text={`${tip} ${src[k]?.description ?? ""}`} />
                  <SourceBadge s={src[k]} />
                </div>
                <SliderField label={label} value={v.wacc[k]} onChange={setW(k)} min={min} max={max} step={step} scale={k === "beta" ? 1 : 100} decimals={k === "beta" ? 2 : 2} suffix={k === "beta" ? "" : "%"} testId={`wacc-${k}`} />
              </div>
            ))}
            <dl className="grid grid-cols-2 gap-y-1 rounded border border-line bg-bg-2 px-3 py-2 text-[12px]">
              <dt className="text-fg-2">Cost of equity (CAPM)</dt>
              <dd className="num text-right">{pct(computed.costOfEquity, 2)}</dd>
              <dt className="text-fg-2">After-tax cost of debt</dt>
              <dd className="num text-right">{pct(computed.afterTaxCostOfDebt, 2)}</dd>
              <dt className="text-fg-2">Computed WACC</dt>
              <dd className="num text-right">{pct(computed.wacc, 2)}</dd>
            </dl>
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={v.waccOverride !== null} onChange={(e) => setV((val) => ({ ...val, waccOverride: e.target.checked ? computed.wacc : null }))} />
              Override WACC
            </label>
            {v.waccOverride !== null && <SliderField label="WACC (override)" value={v.waccOverride} onChange={(x) => setV((val) => ({ ...val, waccOverride: x }), "waccOverride")} min={0.03} max={0.2} step={0.0005} decimals={2} testId="wacc-override" />}
          </div>
        </Card>

        <Card title="Terminal value & timing">
          <div className="space-y-3">
            <Segmented
              label="Terminal method"
              value={v.terminalMethod}
              onChange={(m) => setV((val) => ({ ...val, terminalMethod: m }))}
              options={[
                { value: "perpetuity", label: "Perpetuity growth" },
                { value: "exitMultiple", label: "Exit multiple" },
              ]}
            />
            <SliderField label="Terminal growth (g)" value={v.terminalGrowth} onChange={(x) => setV((val) => ({ ...val, terminalGrowth: x }), "g")} min={-0.02} max={0.06} step={0.0005} decimals={2} hint={`${src.terminalGrowth?.description}. Used by the perpetuity method; must be below WACC.`} testId="terminal-growth" />
            <SliderField label="Exit multiple (EV/EBITDA)" value={v.exitMultiple} onChange={(x) => setV((val) => ({ ...val, exitMultiple: x }), "exit")} min={2} max={40} step={0.5} scale={1} decimals={1} suffix="x" hint={src.exitMultiple?.description} testId="exit-multiple" />
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={v.midYearConvention} onChange={(e) => setV((val) => ({ ...val, midYearConvention: e.target.checked }))} data-testid="mid-year" />
              Mid-year convention <Tip text="Assumes cash flows arrive mid-period. Under this convention the perpetuity terminal value is discounted half a year earlier; an exit-multiple value is discounted at period end." />
            </label>
            <SliderField label="Stub: share of first year remaining" value={v.stubFraction} onChange={(x) => setV((val) => ({ ...val, stubFraction: x }), "stub")} min={0} max={1} step={0.01} decimals={1} hint={src.stubFraction?.description} testId="stub" />
            {result.ok && (
              <dl className="grid grid-cols-2 gap-y-1 rounded border border-line bg-bg-2 px-3 py-2 text-[12px]">
                <dt className="text-fg-2">Terminal value</dt>
                <dd className="num text-right">{compactUsd(result.terminalValue)}</dd>
                <dt className="text-fg-2">Discounted at t =</dt>
                <dd className="num text-right">{result.terminalDiscountTime.toFixed(2)} yrs</dd>
                <dt className="text-fg-2">PV of terminal value</dt>
                <dd className="num text-right">{compactUsd(result.pvTerminalValue)}</dd>
                <dt className="text-fg-2">{v.terminalMethod === "perpetuity" ? "Implied exit multiple" : "Implied perpetual growth"}</dt>
                <dd className="num text-right">{v.terminalMethod === "perpetuity" ? multiple(result.impliedExitMultiple) : pct(result.impliedPerpetualGrowth, 2)}</dd>
              </dl>
            )}
          </div>
        </Card>

        <Card title="Operating drivers (all forecast years)">
          <div className="space-y-3">
            <SliderField label="Revenue growth" value={f.revenueGrowth[0]!} onChange={setAll("revenueGrowth")} min={-0.2} max={0.4} step={0.0025} hint={`${src.revenueGrowth?.description}.${mixed("revenueGrowth")}`} testId="driver-growth" />
            <SliderField label={f.marginMethod === "operatingMargin" ? "EBIT margin" : "Gross margin (cost build-up)"} value={f[marginKey][0]!} onChange={setAll(marginKey)} min={-0.2} max={f.marginMethod === "operatingMargin" ? 0.6 : 0.95} step={0.0025} hint={`${src[marginKey]?.description}.${mixed(marginKey)}`} testId="driver-margin" />
            <SliderField label="Capex % revenue" value={f.capexPct[0]!} onChange={setAll("capexPct")} min={0} max={0.3} step={0.0025} hint={`${src.capexPct?.description}.${mixed("capexPct")}`} testId="driver-capex" />
            <SliderField label="Operating NWC % revenue" value={f.nwcPct[0]!} onChange={setAll("nwcPct")} min={-0.3} max={0.5} step={0.0025} hint={`${src.nwcPct?.description}.${mixed("nwcPct")}`} testId="driver-nwc" />
            <p className="text-[11px] text-fg-2">Year-by-year control lives in the Forecasting grid. Both views edit the same assumptions.</p>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Discounted cash flows (USD millions)">
          <div className="overflow-x-auto">
            <table className="fin-table text-[12.5px]">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  {result.years.map((y) => (
                    <th key={y.label} scope="col">
                      {y.label}
                    </th>
                  ))}
                  <th scope="col">Terminal</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Revenue", (y) => millions(y.revenue)],
                    ["EBITDA", (y) => millions(y.ebitda)],
                    ["NOPAT", (y) => millions(y.nopat)],
                    ["FCFF", (y) => millions(y.fcff)],
                  ] as [string, (y: ForecastYear) => string][]
                ).map(([label, fn]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {result.years.map((y) => (
                      <td key={y.label} className="num">
                        {fn(y)}
                      </td>
                    ))}
                    <td className="num text-fg-2">{label === "FCFF" && result.ok ? millions(result.terminalValue) : ""}</td>
                  </tr>
                ))}
                {result.ok && (
                  <>
                    <tr>
                      <th scope="row">Share of year counted</th>
                      {result.years.map((y) => (
                        <td key={y.label} className="num text-fg-2">
                          {pct(y.periodFraction, 0)}
                        </td>
                      ))}
                      <td />
                    </tr>
                    <tr>
                      <th scope="row">Discount time (yrs)</th>
                      {result.years.map((y) => (
                        <td key={y.label} className="num text-fg-2">
                          {y.discountTime.toFixed(2)}
                        </td>
                      ))}
                      <td className="num text-fg-2">{result.terminalDiscountTime.toFixed(2)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Discount factor</th>
                      {result.years.map((y) => (
                        <td key={y.label} className="num text-fg-2">
                          {y.discountFactor.toFixed(4)}
                        </td>
                      ))}
                      <td className="num text-fg-2">{(result.pvTerminalValue / result.terminalValue).toFixed(4)}</td>
                    </tr>
                    <tr>
                      <th scope="row" className="font-semibold">
                        Present value
                      </th>
                      {result.years.map((y) => (
                        <td key={y.label} className="num font-semibold">
                          {millions(y.presentValue)}
                        </td>
                      ))}
                      <td className="num font-semibold">{millions(result.pvTerminalValue)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Enterprise → equity bridge">
          {result.ok ? (
            <table className="w-full text-[12.5px]" data-testid="bridge">
              <tbody>
                <tr className="border-b border-line">
                  <th scope="row" className="py-1 text-left font-normal">
                    PV of forecast FCFF
                  </th>
                  <td className="num text-right">{millions(result.sumPvFcff)}</td>
                </tr>
                <tr className="border-b border-line">
                  <th scope="row" className="py-1 text-left font-normal">
                    PV of terminal value
                  </th>
                  <td className="num text-right">{millions(result.pvTerminalValue)}</td>
                </tr>
                <tr className="border-b border-line font-semibold">
                  <th scope="row" className="py-1 text-left">
                    Enterprise value
                  </th>
                  <td className="num text-right">{millions(result.enterpriseValue)}</td>
                </tr>
                {(
                  [
                    ["cash", "Cash & equivalents", 1],
                    ["shortTermInvestments", "Short-term investments", 1],
                    ["nonOperatingAssets", "Non-operating assets", 1],
                    ["debt", "Total debt", -1],
                    ["minorityInterest", "Noncontrolling interest", -1],
                    ["preferredEquity", "Preferred equity", -1],
                  ] as const
                ).map(([k, label, sign]) => (
                  <tr key={k} className="border-b border-line">
                    <th scope="row" className="py-1 text-left font-normal">
                      <span className="flex items-center gap-1.5">
                        {sign > 0 ? "+" : "−"} {label} <SourceBadge s={src[`bridge.${k}`]} />
                      </span>
                    </th>
                    <td className="py-0.5 text-right">
                      <NumberCell value={v.bridge[k]} onCommit={setB(k)} scale={1e-6} decimals={1} suffix="M" label={label} className="w-28" />
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-line font-semibold">
                  <th scope="row" className="py-1 text-left">
                    Equity value
                  </th>
                  <td className="num text-right">{millions(result.equityValue)}</td>
                </tr>
                <tr className="border-b border-line">
                  <th scope="row" className="py-1 text-left font-normal">
                    <span className="flex items-center gap-1.5">
                      ÷ Diluted shares <SourceBadge s={src.dilutedShares} />
                    </span>
                  </th>
                  <td className="py-0.5 text-right">
                    <NumberCell value={v.dilutedShares} onCommit={(x) => setV((val) => ({ ...val, dilutedShares: x }))} scale={1e-6} decimals={1} suffix="M" label="Diluted shares" min={1} className="w-28" />
                  </td>
                </tr>
                <tr className="font-semibold text-valuation">
                  <th scope="row" className="py-1 text-left">
                    Value per share
                  </th>
                  <td className="num text-right">{usd(result.perShare)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-fg-2">Resolve the errors above to compute the bridge.</p>
          )}
          <p className="mt-2 text-[11px] text-fg-2">Amounts in USD millions. Balance-sheet items are as of {defaults.bridgeAsOf}. Share count does not recompute treasury-stock dilution.</p>
        </Card>
      </div>

      <Card title="Sensitivity: value per share">
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <div>
            <div className="mb-1 text-[12px] text-fg-2">{v.terminalMethod === "perpetuity" ? "WACC vs terminal growth" : "WACC vs exit multiple"}</div>
            <SensitivityTable inputs={inputs} xParam="wacc" yParam={v.terminalMethod === "perpetuity" ? "terminalGrowth" : "exitMultiple"} reference={v.referencePrice} testId="sens-wacc" />
          </div>
          <div>
            <div className="mb-1 text-[12px] text-fg-2">Revenue growth vs operating margin (shifts applied to every forecast year)</div>
            <SensitivityTable inputs={inputs} xParam="revenueGrowthShift" yParam="operatingMarginShift" reference={v.referencePrice} testId="sens-ops" />
          </div>
        </div>
      </Card>
    </div>
  );
}
