"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useModel, useWorkspace } from "@/components/workspace/context";
import { NumberCell } from "@/components/workspace/inputs";
import { Alert, Badge, Button, Card, cx, Tip } from "@/components/ui/primitives";
import { runScenario, type Scenario, type ScenarioAdjustments } from "@/lib/finance/sensitivity";
import { DASH, pct, signedPct, usd } from "@/lib/format";

const ADJ: { key: keyof ScenarioAdjustments; label: string; scale: number; suffix: string; tip: string }[] = [
  { key: "revenueGrowthDelta", label: "Revenue growth Δ", scale: 100, suffix: "pp", tip: "Added to revenue growth in every forecast year." },
  { key: "operatingMarginDelta", label: "Margin Δ", scale: 100, suffix: "pp", tip: "Added to EBIT margin (or gross margin under cost build-up) in every forecast year." },
  { key: "waccDelta", label: "WACC Δ", scale: 100, suffix: "pp", tip: "Added to the applied WACC." },
  { key: "terminalGrowthDelta", label: "Terminal growth Δ", scale: 100, suffix: "pp", tip: "Added to terminal growth." },
  { key: "exitMultipleDelta", label: "Exit multiple Δ", scale: 1, suffix: "x", tip: "Added to the exit multiple." },
];

export default function ScenariosPage() {
  const { defaults, defaultsError } = useWorkspace();
  const { state, valuation, update } = useModel();

  const summaries = useMemo(() => {
    if (!defaults || !state || !valuation) return [];
    const inputs = { base: defaults.base, forecast: state.forecast, valuation };
    return state.scenarios.map((s) => ({ scenario: s, summary: runScenario(inputs, s.adjustments) }));
  }, [defaults, state, valuation]);

  if (defaultsError || !defaults || !state) return <Alert tone="neg" title="Scenarios unavailable">{defaultsError ?? "Loading model…"}</Alert>;

  const setScenario = (id: string, fn: (s: Scenario) => Scenario, tag?: string) =>
    update((st) => ({ ...st, scenarios: st.scenarios.map((s) => (s.id === id ? fn(s) : s)) }), tag);
  const addCustom = () =>
    update((st) => {
      const n = st.scenarios.filter((s) => s.kind === "custom").length + 1;
      const id = `custom-${Date.now().toString(36)}`;
      return { ...st, scenarios: [...st.scenarios, { id, name: `Custom ${n}`, kind: "custom", illustrative: false, adjustments: { revenueGrowthDelta: 0, operatingMarginDelta: 0, waccDelta: 0, terminalGrowthDelta: 0, exitMultipleDelta: 0 } }] };
    });
  const remove = (id: string) => update((st) => ({ ...st, scenarios: st.scenarios.filter((s) => s.id !== id) }));

  const metricRows: { label: string; kind: "Calculated" | "Input"; value: (i: number) => string }[] = [
    { label: "Revenue CAGR (forecast)", kind: "Calculated", value: (i) => pct(summaries[i]!.summary.revenueCagr) },
    { label: "Final-year EBITDA margin", kind: "Calculated", value: (i) => pct(summaries[i]!.summary.finalEbitdaMargin) },
    { label: "WACC", kind: "Input", value: (i) => pct(summaries[i]!.summary.wacc, 2) },
    { label: "Terminal growth", kind: "Input", value: (i) => pct(summaries[i]!.summary.terminalGrowth, 2) },
    { label: "Intrinsic value / share", kind: "Calculated", value: (i) => usd(summaries[i]!.summary.perShare) },
    { label: "Implied return vs reference", kind: "Calculated", value: (i) => signedPct(summaries[i]!.summary.impliedReturn) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold">Scenarios</h1>
        <Button variant="outline" onClick={addCustom}>
          <Plus size={14} /> Custom scenario
        </Button>
        <span className="text-[11px] text-fg-2">Scenarios apply adjustments on top of the current base assumptions and are saved with the workspace.</span>
      </div>
      {state.scenarios.some((s) => s.illustrative) && (
        <Alert tone="warn" title="Illustrative defaults">
          Bear/Base/Bull adjustments are placeholders, not research conclusions. Review each one and mark it reviewed once you have set your own assumptions.
        </Alert>
      )}

      <Card title="Scenario comparison">
        <div className="overflow-x-auto">
          <table className="fin-table text-[12.5px]" data-testid="scenario-table">
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col" className="!text-left">
                  Type
                </th>
                {state.scenarios.map((s) => (
                  <th key={s.id} scope="col" className={cx(s.kind === "bear" && "!text-neg", s.kind === "bull" && "!text-pos")}>
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metricRows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td className="!text-left text-fg-2">{r.kind}</td>
                  {summaries.map((x, i) => (
                    <td key={x.scenario.id} className={cx("num", r.label.startsWith("Intrinsic") && "font-semibold text-valuation")} title={!x.summary.result.ok ? x.summary.result.errors.join(" ") : undefined}>
                      {x.summary.result.ok || r.kind === "Input" || r.label.includes("CAGR") || r.label.includes("EBITDA") ? r.value(i) : DASH}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {summaries.some((x) => !x.summary.result.ok) && <p className="mt-2 text-[11px] text-neg">Some scenarios are invalid (hover “—” for the reason, e.g. terminal growth ≥ WACC).</p>}
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {state.scenarios.map((s) => (
          <Card
            key={s.id}
            title={
              s.kind === "custom" ? (
                <input
                  aria-label="Scenario name"
                  value={s.name}
                  maxLength={40}
                  onChange={(e) => setScenario(s.id, (x) => ({ ...x, name: e.target.value }), `name:${s.id}`)}
                  className="rounded border border-line bg-bg-2 px-1.5 py-0.5"
                />
              ) : (
                s.name
              )
            }
            actions={
              <>
                {s.illustrative ? <Badge tone="warn">Illustrative</Badge> : <Badge tone="pos">Reviewed</Badge>}
                {s.illustrative && (
                  <Button onClick={() => setScenario(s.id, (x) => ({ ...x, illustrative: false }))} title="Mark these adjustments as reviewed by you">
                    <Check size={13} /> Mark reviewed
                  </Button>
                )}
                {s.kind === "custom" && (
                  <Button onClick={() => remove(s.id)} aria-label={`Delete ${s.name}`}>
                    <Trash2 size={13} />
                  </Button>
                )}
              </>
            }
          >
            {s.kind === "base" ? (
              <p className="text-[12px] text-fg-2">The base case uses the current Forecasting and DCF assumptions without adjustments.</p>
            ) : (
              <div className="space-y-1.5">
                {ADJ.map((a) => (
                  <div key={a.key} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-[12px] text-fg-2">
                      {a.label} <Tip text={a.tip} />
                    </span>
                    <NumberCell
                      value={s.adjustments[a.key]}
                      onCommit={(v) => setScenario(s.id, (x) => ({ ...x, illustrative: false, adjustments: { ...x.adjustments, [a.key]: v } }))}
                      scale={a.scale}
                      decimals={a.scale === 1 ? 1 : 2}
                      suffix={a.suffix}
                      label={`${s.name} ${a.label}`}
                      className="w-24"
                      testId={`scn-${s.id}-${a.key}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
