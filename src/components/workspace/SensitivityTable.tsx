"use client";

import { useMemo, useState } from "react";
import { cx } from "@/components/ui/primitives";
import { axisAround, currentParamValue, SENSITIVITY_LABELS, sensitivityGrid, type ModelInputs, type SensitivityParam } from "@/lib/finance/sensitivity";
import { multiple, pct, signedPct, usd } from "@/lib/format";

const fmtParam = (p: SensitivityParam, v: number) => (p === "exitMultiple" ? multiple(v) : p.endsWith("Shift") ? signedPct(v) : pct(v, 2));

const STEPS: Record<SensitivityParam, number> = { wacc: 0.005, terminalGrowth: 0.005, exitMultiple: 1, revenueGrowthShift: 0.01, operatingMarginShift: 0.01 };

/**
 * Two-variable sensitivity matrix. Each cell is a full re-run of the DCF engine with the
 * two parameters set; invalid combinations show the engine's error instead of a value.
 */
export function SensitivityTable({ inputs, xParam, yParam, reference, testId }: { inputs: ModelInputs; xParam: SensitivityParam; yParam: SensitivityParam; reference: number | null; testId?: string }) {
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
  const grid = useMemo(() => {
    const xs = axisAround(currentParamValue(inputs, xParam), STEPS[xParam]);
    const ys = axisAround(currentParamValue(inputs, yParam), STEPS[yParam]);
    return sensitivityGrid(inputs, xParam, xs, yParam, ys);
  }, [inputs, xParam, yParam]);

  const center = grid.rows[2]?.[2]?.perShare ?? null;
  const anchor = reference ?? center;
  const color = (v: number | null) => {
    if (v === null || anchor === null || anchor === 0) return undefined;
    const d = Math.max(-1, Math.min(1, (v / anchor - 1) / 0.5));
    const c = d >= 0 ? "16,185,129" : "239,68,68";
    return { backgroundColor: `rgba(${c},${(Math.abs(d) * 0.45).toFixed(3)})` };
  };
  const sel = selected ? grid.rows[selected.r]?.[selected.c] : null;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12px]" data-testid={testId}>
          <thead>
            <tr>
              <th className="p-1.5 text-left text-[10.5px] font-normal text-fg-2">
                {SENSITIVITY_LABELS[yParam]} ↓ / {SENSITIVITY_LABELS[xParam]} →
              </th>
              {grid.xValues.map((x) => (
                <th key={x} scope="col" className="num p-1.5 text-right font-medium text-fg-2">
                  {fmtParam(xParam, x)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row, r) => (
              <tr key={r}>
                <th scope="row" className="num p-1.5 text-left font-medium text-fg-2">
                  {fmtParam(yParam, grid.yValues[r]!)}
                </th>
                {row.map((cell, c) => (
                  <td key={c} className="p-0.5">
                    <button
                      type="button"
                      onClick={() => setSelected({ r, c })}
                      title={cell.error ?? `${SENSITIVITY_LABELS[xParam]} ${fmtParam(xParam, cell.x)}, ${SENSITIVITY_LABELS[yParam]} ${fmtParam(yParam, cell.y)}`}
                      style={color(cell.perShare)}
                      className={cx(
                        "num w-full rounded px-1.5 py-1 text-right",
                        r === 2 && c === 2 && "ring-1 ring-valuation",
                        selected?.r === r && selected.c === c && "outline outline-1 outline-accent",
                        cell.perShare === null && "text-fg-2",
                      )}
                    >
                      {cell.perShare === null ? "n/a" : usd(cell.perShare)}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-fg-2">
        Value per share. Outlined center = current model. Shading vs {reference !== null ? `reference price ${usd(reference)}` : "current model value"} (green above, red below). “n/a” = invalid combination (e.g. growth ≥ WACC).
      </p>
      {sel && (
        <div className="mt-2 rounded border border-line bg-bg-2 px-3 py-2 text-[12px]" data-testid={testId ? `${testId}-detail` : undefined}>
          <span className="text-fg-2">Cell inputs:</span> {SENSITIVITY_LABELS[xParam]} = {fmtParam(xParam, sel.x)}; {SENSITIVITY_LABELS[yParam]} = {fmtParam(yParam, sel.y)}; all other assumptions as in the current model.{" "}
          {sel.perShare !== null ? (
            <>
              → <span className="num">{usd(sel.perShare)}</span>/share (EV <span className="num">{usd(sel.enterpriseValue! / 1e9, 1)}B</span>)
            </>
          ) : (
            <span className="text-neg">{sel.error}</span>
          )}
        </div>
      )}
    </div>
  );
}
