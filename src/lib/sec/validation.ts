/**
 * Data-integrity checks. Checks FLAG discrepancies; they never alter source values.
 */
import { METRICS, type MetricId } from "./concepts";
import type { StatementSet } from "./statements";
import { daysBetweenInclusive, isAnnualDuration } from "./xbrl";
import type { CompanyFactsJson } from "./types";

export type Severity = "error" | "warning" | "info";

export interface ValidationIssue {
  id: string;
  severity: Severity;
  check: string;
  period?: string;
  message: string;
}

const pct = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1);

export function validateStatements(set: StatementSet, cf: CompanyFactsJson): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const L = set.lines;

  set.periods.forEach((p, i) => {
    // 1. Balance sheet identity.
    const assets = L.totalAssets[i]?.value ?? null;
    const le = L.liabilitiesAndEquity[i]?.value ?? null;
    const liab = L.totalLiabilities[i]?.value ?? null;
    const eq = L.totalEquity[i]?.value ?? null;
    const mi = L.minorityInterest[i]?.value ?? null;
    if (assets !== null && le !== null && pct(assets, le) > 0.005) {
      issues.push({ id: `bs-le-${p.key}`, severity: "error", check: "Balance sheet identity", period: p.label, message: `Total assets (${assets}) ≠ total liabilities & equity (${le}).` });
    }
    if (assets !== null && liab !== null && eq !== null) {
      const rhs = liab + eq + (mi ?? 0);
      if (pct(assets, rhs) > 0.005) {
        issues.push({
          id: `bs-sum-${p.key}`,
          severity: "warning",
          check: "Balance sheet identity",
          period: p.label,
          message: `Assets differ from liabilities + equity${mi === null ? " (noncontrolling interest not reported)" : " + NCI"} by ${(pct(assets, rhs) * 100).toFixed(2)}%. May reflect taxonomy mapping (e.g. mezzanine equity).`,
        });
      }
    } else if (assets !== null && le === null) {
      issues.push({ id: `bs-missing-${p.key}`, severity: "info", check: "Balance sheet identity", period: p.label, message: "Identity not checked: liabilities or equity totals not reported." });
    }

    // 2. Cash reconciliation (annual only — consecutive balance-sheet dates).
    if (set.frequency === "annual" && i > 0) {
      const c0 = L.cash[i - 1]?.value ?? null;
      const c1 = L.cash[i]?.value ?? null;
      const chg = L.netChangeInCash[i]?.value ?? null;
      if (c0 !== null && c1 !== null && chg !== null && Math.abs(c1 - c0 - chg) > Math.max(Math.abs(chg) * 0.01, 1e6)) {
        issues.push({
          id: `cash-${p.key}`,
          severity: "info",
          check: "Cash reconciliation",
          period: p.label,
          message: "Change in balance-sheet cash differs from cash-flow net change (often restricted cash or FX presentation).",
        });
      }
    }

    // 3. Plausible period durations.
    if (p.kind === "annual" && !isAnnualDuration(p.days)) {
      issues.push({ id: `dur-${p.key}`, severity: "warning", check: "Period duration", period: p.label, message: `Annual period spans ${p.days} days.` });
    }

    // 4. Unexpected signs.
    const rev = L.revenue[i]?.value ?? null;
    if (rev !== null && rev < 0) issues.push({ id: `sign-rev-${p.key}`, severity: "warning", check: "Sign convention", period: p.label, message: "Revenue is negative." });
    const capex = L.capex[i]?.value ?? null;
    if (capex !== null && capex < 0) {
      issues.push({ id: `sign-capex-${p.key}`, severity: "warning", check: "Sign convention", period: p.label, message: "Capital expenditure payments reported as negative; sign convention may differ." });
    }

    // 5. Restatements (informational — later filings replaced earlier values).
    for (const id of Object.keys(METRICS) as MetricId[]) {
      const r = L[id][i]?.restatement;
      if (r) {
        issues.push({
          id: `restated-${id}-${p.key}`,
          severity: "info",
          check: "Restatement",
          period: p.label,
          message: `${METRICS[id].label} restated: originally ${r.originalValue.toLocaleString("en-US")} (${r.originalForm} filed ${r.originalFiled}); now ${L[id][i]!.value?.toLocaleString("en-US")}.`,
        });
      }
    }
  });

  // 6. Missing core inputs over the latest period.
  const last = set.periods.length - 1;
  if (last >= 0) {
    for (const id of ["revenue", "operatingIncome", "netIncome", "cfo", "capex", "cash", "totalAssets"] as MetricId[]) {
      if (L[id][last]?.value === null) {
        issues.push({ id: `missing-${id}`, severity: "warning", check: "Missing required input", period: set.periods[last]!.label, message: `${METRICS[id].label} not available for the latest period.` });
      }
    }
  }

  // 7. Raw-data checks: unexpected units and conflicting duplicates in the same filing.
  for (const [taxonomy, concepts] of Object.entries(cf.facts)) {
    for (const [tag, concept] of Object.entries(concepts)) {
      for (const [unit, list] of Object.entries(concept.units)) {
        const expected = Object.values(METRICS).find((m) => m.concepts.some((c) => c.taxonomy === taxonomy && c.tag === tag));
        if (expected && unit !== expected.unit) {
          issues.push({ id: `unit-${tag}-${unit}`, severity: "warning", check: "Units", message: `${tag} reported in unexpected unit "${unit}" (expected ${expected.unit}); excluded from normalization.` });
        }
        if (!expected) continue;
        const seen = new Map<string, number>();
        const nonNumeric = list.filter((o) => !Number.isFinite(o.val)).length;
        if (nonNumeric > 0) {
          issues.push({ id: `nan-${tag}-${unit}`, severity: "warning", check: "Non-numeric values", message: `${tag} has ${nonNumeric} non-numeric observation(s); excluded from normalization.` });
        }
        for (const o of list) {
          if (!Number.isFinite(o.val)) continue;
          const key = `${o.accn}|${o.start ?? ""}|${o.end}`;
          const prior = seen.get(key);
          if (prior !== undefined && prior !== o.val) {
            issues.push({ id: `dup-${tag}-${key}`, severity: "warning", check: "Duplicate observations", message: `${tag} has conflicting values for ${o.start ?? ""}–${o.end} within filing ${o.accn}.` });
          }
          seen.set(key, o.val);
          if (o.start && expected.periodType === "duration" && daysBetweenInclusive(o.start, o.end) > 400) {
            issues.push({ id: `longdur-${tag}-${key}`, severity: "info", check: "Period duration", message: `${tag} observation spans more than 400 days (${o.start}–${o.end}); ignored.` });
          }
        }
      }
    }
  }
  return issues;
}
