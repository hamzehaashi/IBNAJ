"use client";

import { CandlestickChart } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useModel, useWorkspace } from "@/components/workspace/context";
import { Badge, Card, EmptyState, Kpi, Tip } from "@/components/ui/primitives";
import { marketMetrics, type Derived } from "@/lib/finance/market";
import { freshnessLabel, PriceEditor } from "@/components/workspace/PriceEditor";
import type { LineId } from "@/lib/sec/statements";
import { compactUsd, dateLabel, millions, multiple, pct, shares, signedPct, usd } from "@/lib/format";

function Field({ label, children, tip }: { label: string; children: React.ReactNode; tip?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-1.5 last:border-0">
      <dt className="flex items-center gap-1 text-fg-2">
        {label}
        {tip && <Tip text={tip} />}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function DerivedValue({ d, fmt }: { d: Derived; fmt: (v: number) => string }) {
  if (d.value === null) return <span className="text-fg-2" title={d.reason}>— <Tip text={`${d.formula}. ${d.reason ?? ""}`} /></span>;
  return (
    <span className="num">
      {fmt(d.value)} <Tip text={`${d.formula}${d.basis ? ` (${d.basis})` : ""}.`} />
    </span>
  );
}

const Unavailable = ({ what }: { what: string }) => (
  <span className="text-fg-2">
    Unavailable <Tip text={`${what} requires a licensed market-data provider, which is not configured. Caldun does not display estimated or scraped values.`} />
  </span>
);

export default function OverviewPage() {
  const { dataset, price: market } = useWorkspace();
  const { result, state } = useModel();
  const { profile, annual, quarterly, riskFree } = dataset;
  const mm = useMemo(() => marketMetrics(market?.price ?? null, annual, quarterly), [market, annual, quarterly]);
  const base = `/company/${profile.ticker}`;

  const chartData = annual.periods.map((p, i) => {
    const rev = annual.lines.revenue[i]?.value ?? null;
    const oi = annual.lines.operatingIncome[i]?.value ?? null;
    return {
      period: p.label,
      revenue: rev !== null ? rev / 1e6 : null,
      fcf: annual.lines.freeCashFlow[i]?.value != null ? annual.lines.freeCashFlow[i]!.value! / 1e6 : null,
      margin: rev && oi !== null ? (oi / rev) * 100 : null,
    };
  });
  const last = annual.periods.length - 1;
  const v = (line: LineId) => annual.lines[line]?.[last]?.value ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{profile.name}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-fg-2">
            <span className="num text-accent">{profile.ticker}</span>
            {profile.exchange && <span>{profile.exchange}</span>}
            {profile.industry && <span>· {profile.industry}</span>}
            {dataset.meta.mode === "demo" && <Badge tone="warn">Synthetic data</Badge>}
          </div>
        </div>
        <div className="text-[11px] text-fg-2">Latest fiscal period: {annual.periods[last]?.label ?? "—"} (ended {annual.periods[last] ? dateLabel(annual.periods[last]!.end) : "—"})</div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          label="Reference price"
          value={market ? usd(market.price) : "—"}
          sub={market ? `${freshnessLabel(market.freshness)} · ${dateLabel(market.asOf)}` : "Enter a price in the top bar"}
          tip={market ? `${market.label}. ${market.source}. Not live.` : "No licensed market-data feed is configured. Enter the price you want to use."}
        />
        <Kpi label="Market cap" value={compactUsd(mm.marketCap.value)} sub={mm.marketCap.basis ?? mm.marketCap.reason} tip={mm.marketCap.formula} />
        <Kpi label="Revenue" value={compactUsd(v("revenue"))} sub={annual.periods[last]?.label} />
        <Kpi
          label="DCF value / share"
          tone="valuation"
          value={result?.ok ? usd(result.perShare) : "—"}
          sub={result?.ok ? (result.upside !== null ? `${signedPct(result.upside)} vs reference` : "No reference price") : (result?.errors[0] ?? "Model unavailable")}
          tip="From the live DCF model (Forecasting + DCF modules). Changes to assumptions update this value."
        />
        <Kpi
          label="Model WACC / g"
          value={result?.ok ? `${pct(result.wacc.applied)} / ${pct(state?.valuation.terminalGrowth)}` : "—"}
          sub={state?.valuation.terminalMethod === "exitMultiple" ? `Exit multiple ${multiple(state.valuation.exitMultiple)}` : "Perpetuity growth method"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Company" className="xl:col-span-1">
          <dl>
            <Field label="Name">{profile.name}</Field>
            <Field label="Ticker">{profile.ticker}</Field>
            <Field label="Exchange">{profile.exchange ?? "Not reported"}</Field>
            <Field label="Industry (SIC)" tip="SEC Standard Industrial Classification from EDGAR. Not a GICS sector.">{profile.industry ? `${profile.industry} (${profile.sic})` : "Not reported"}</Field>
            <Field label="Headquarters">{profile.headquarters ?? "Not reported"}</Field>
            <Field label="Reporting currency">{profile.reportingCurrency}</Field>
            <Field label="Fiscal year end">{profile.fiscalYearEnd ?? "Not reported"}</Field>
            <Field label="CIK">{profile.cik}</Field>
          </dl>
          <p className="mt-3 text-[12px] text-fg-2">Business description: not available from current data sources (filing text extraction is planned).</p>
        </Card>

        <Card title="Market data" className="xl:col-span-1">
          <dl>
            <Field label="Price" tip="The price Caldun uses for market cap, multiples, dividend yield and DCF upside. Never live.">
              <PriceEditor />
            </Field>
            <Field label="Shares outstanding">
              <DerivedValue d={mm.sharesOutstanding} fmt={shares} />
            </Field>
            <Field label="Market capitalization">
              <DerivedValue d={mm.marketCap} fmt={compactUsd} />
            </Field>
            <Field label="Enterprise value" tip="Market capitalization plus debt and noncontrolling interest, less cash and short-term investments.">
              <DerivedValue d={mm.enterpriseValue} fmt={compactUsd} />
            </Field>
            <Field label="P/E" tip="Price divided by diluted earnings per share.">
              <DerivedValue d={mm.pe} fmt={(x) => multiple(x)} />
            </Field>
            <Field label="EV/EBITDA" tip="Enterprise value divided by EBITDA (operating income + D&A).">
              <DerivedValue d={mm.evEbitda} fmt={(x) => multiple(x)} />
            </Field>
            <Field label="52-week high / low"><Unavailable what="52-week range" /></Field>
            <Field label="Volume"><Unavailable what="Trading volume" /></Field>
            <Field label="Beta" tip="Sensitivity of the stock's returns to the market."><Unavailable what="Beta" /></Field>
            <Field label="Dividend yield" tip="Dividends declared per share in the latest fiscal year (from filings) divided by the price.">
              <DerivedValue d={mm.dividendYield} fmt={(x) => pct(x, 2)} />
            </Field>
            <Field label="Risk-free rate (10-yr Treasury)" tip="Used as the risk-free rate in the WACC.">
              {riskFree.ok ? (
                <span className="num" data-testid="risk-free">
                  {pct(riskFree.quote.rate, 2)} <Tip text={`${riskFree.quote.source}, ${riskFree.quote.tenor} par yield as of ${dateLabel(riskFree.quote.asOf)}. Public-domain data.`} />
                </span>
              ) : (
                <span className="text-fg-2" data-testid="risk-free">
                  Unavailable <Tip text={`${riskFree.reason} The WACC uses an illustrative 4.25% instead.`} />
                </span>
              )}
            </Field>
          </dl>
          <p className="mt-2 text-[11px] text-fg-2">Price: {market ? `${market.label} (${market.source})` : "none set"}. Fundamentals and dividends: {dataset.meta.source}.</p>
        </Card>

        <Card title="Price history" className="xl:col-span-1">
          <EmptyState title="Price chart unavailable" icon={<CandlestickChart size={28} />}>
            Interactive price charts (1D–MAX, index comparison, indicators) require a licensed market-data provider. None is configured, so no price series is shown rather than an estimated one.
          </EmptyState>
        </Card>
      </div>

      <Card
        title="Revenue, free cash flow and operating margin"
        actions={
          <Link href={`${base}/statements`} className="text-[12px] text-accent hover:underline">
            View statements →
          </Link>
        }
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="period" stroke="var(--text-2)" fontSize={11} />
              <YAxis yAxisId="usd" stroke="var(--text-2)" fontSize={11} tickFormatter={(x: number) => `${(x / 1000).toFixed(0)}B`} />
              <YAxis yAxisId="pct" orientation="right" stroke="var(--text-2)" fontSize={11} tickFormatter={(x: number) => `${x.toFixed(0)}%`} />
              <Tooltip
                contentStyle={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
                formatter={(val, name) => (name === "Operating margin" ? `${Number(val).toFixed(1)}%` : `$${millions(Number(val) * 1e6)}M`)}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="usd" dataKey="revenue" name="Revenue" fill="var(--accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar yAxisId="usd" dataKey="fcf" name="Free cash flow" fill="var(--pos)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Line yAxisId="pct" dataKey="margin" name="Operating margin" stroke="var(--warn)" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] text-fg-2">USD. Free cash flow = cash from operations − capital expenditures (calculated). Missing values are left as gaps.</p>
      </Card>
    </div>
  );
}
