/**
 * XBRL normalization: turns raw `companyfacts` observations into period-correct values
 * with full provenance.
 *
 * Rules enforced here (see docs/ARCHITECTURE.md § Data integrity):
 *  1. The measured period comes from start/end, never from the filing's fy/fp.
 *  2. Balance-sheet (instant) values are snapshots at exactly the period-end date.
 *  3. Duplicate observations of one period are collapsed by filing date; with `asOf`
 *     only observations filed on or before that date are visible (point-in-time).
 *  4. Quarterly flows are derived from YTD disclosures only with matched periods and the
 *     same XBRL tag; per-share / weighted-share metrics are never derived by subtraction.
 *  5. Missing values stay missing (null + status); they are never coerced to zero.
 */
import { METRICS, type MetricDefinition, type MetricId } from "./concepts";
import type { CompanyFactsJson, RawFactObservation } from "./types";

const DAY_MS = 86_400_000;

export type CellStatus = "reported" | "derived" | "calculated" | "not_reported" | "not_applicable" | "unavailable";

export interface SourceRef {
  taxonomy: string;
  tag: string;
  unit: string;
  accn: string;
  form: string;
  filed: string;
  start?: string;
  end: string;
  value: number;
}

export interface Cell {
  value: number | null;
  status: CellStatus;
  sources?: SourceRef[];
  formula?: string;
  note?: string;
  /** Present when a later filing changed the originally reported value. */
  restatement?: { originalValue: number; originalFiled: string; originalForm: string };
}

export interface FiscalPeriod {
  /** Stable key, e.g. "FY2024" or "FY2024-Q2". */
  key: string;
  label: string;
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | 4 | null;
  start: string;
  end: string;
  days: number;
  kind: "annual" | "quarter";
}

export interface NormalizeOptions {
  /** Point-in-time cutoff (ISO date). Only filings accepted on/before this date are used. */
  asOf?: string;
}

const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "10-KT", "10-KT/A", "20-F", "20-F/A", "40-F", "40-F/A"]);

export const toTime = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const daysBetweenInclusive = (start: string, end: string) => Math.round((toTime(end) - toTime(start)) / DAY_MS) + 1;
const addDays = (iso: string, n: number) => new Date(toTime(iso) + n * DAY_MS).toISOString().slice(0, 10);

export const isAnnualDuration = (days: number) => days >= 350 && days <= 380;
export const isQuarterDuration = (days: number) => days >= 80 && days <= 100;

interface TaggedObservation extends RawFactObservation {
  taxonomy: string;
  tag: string;
  unit: string;
}

function observationsFor(cf: CompanyFactsJson, taxonomy: string, tag: string, unit: string, opts: NormalizeOptions): TaggedObservation[] {
  const raw = cf.facts[taxonomy]?.[tag]?.units[unit];
  if (!raw) return [];
  return raw
    .filter((o) => Number.isFinite(o.val) && (!opts.asOf || o.filed <= opts.asOf))
    .map((o) => ({ ...o, taxonomy, tag, unit }));
}

/**
 * Collapse duplicate observations of the same period. The latest filing wins (it carries
 * restatements); ties prefer amendments, then the later accession number.
 */
export function pickLatest(obs: TaggedObservation[]): { chosen: TaggedObservation; original: TaggedObservation } | null {
  if (obs.length === 0) return null;
  const sorted = [...obs].sort((a, b) => {
    if (a.filed !== b.filed) return a.filed < b.filed ? -1 : 1;
    const aAmend = a.form.endsWith("/A") ? 1 : 0;
    const bAmend = b.form.endsWith("/A") ? 1 : 0;
    if (aAmend !== bAmend) return aAmend - bAmend;
    return a.accn < b.accn ? -1 : a.accn > b.accn ? 1 : 0;
  });
  return { chosen: sorted[sorted.length - 1]!, original: sorted[0]! };
}

function toSource(o: TaggedObservation): SourceRef {
  return { taxonomy: o.taxonomy, tag: o.tag, unit: o.unit, accn: o.accn, form: o.form, filed: o.filed, start: o.start, end: o.end, value: o.val };
}

function reportedCell(pick: { chosen: TaggedObservation; original: TaggedObservation }): Cell {
  const { chosen, original } = pick;
  const cell: Cell = { value: chosen.val, status: "reported", sources: [toSource(chosen)] };
  if (original.val !== chosen.val) {
    cell.restatement = { originalValue: original.val, originalFiled: original.filed, originalForm: original.form };
  }
  return cell;
}

// ------------------------------------------------------------------ fiscal calendar

/** Fallback fiscal-year label when no filing label is available: periods ending in January belong to the prior year. */
export function fiscalYearFromEnd(end: string): number {
  const d = new Date(toTime(end));
  return d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

/** Collect every us-gaap duration observation once (used for calendar detection). */
function allDurationObservations(cf: CompanyFactsJson, opts: NormalizeOptions): RawFactObservation[] {
  const out: RawFactObservation[] = [];
  for (const concept of Object.values(cf.facts["us-gaap"] ?? {})) {
    for (const list of Object.values(concept.units)) {
      for (const o of list) {
        if (o.start && (!opts.asOf || o.filed <= opts.asOf)) out.push(o);
      }
    }
  }
  return out;
}

/**
 * Detect fiscal years from annual-form duration facts of ~one year. Labels come from the
 * `fy` of the ORIGINAL filing for that period (filed within 180 days of period end), which
 * reflects the company's own naming; otherwise from {@link fiscalYearFromEnd}.
 */
export function detectFiscalYears(cf: CompanyFactsJson, opts: NormalizeOptions = {}): FiscalPeriod[] {
  const support = new Map<string, { start: string; end: string; count: number; labels: Map<number, number> }>();
  for (const o of allDurationObservations(cf, opts)) {
    if (!ANNUAL_FORMS.has(o.form)) continue;
    const days = daysBetweenInclusive(o.start!, o.end);
    if (!isAnnualDuration(days)) continue;
    const key = `${o.start}|${o.end}`;
    const entry = support.get(key) ?? { start: o.start!, end: o.end, count: 0, labels: new Map() };
    entry.count++;
    const lag = (toTime(o.filed) - toTime(o.end)) / DAY_MS;
    if (o.fy !== null && lag >= 0 && lag <= 180) entry.labels.set(o.fy, (entry.labels.get(o.fy) ?? 0) + 1);
    support.set(key, entry);
  }

  // One period per end date (highest support), then drop periods overlapping a better-supported one.
  const byEnd = new Map<string, { start: string; end: string; count: number; labels: Map<number, number> }>();
  for (const e of support.values()) {
    const cur = byEnd.get(e.end);
    if (!cur || e.count > cur.count) byEnd.set(e.end, e);
  }
  const ranked = [...byEnd.values()].sort((a, b) => b.count - a.count);
  const kept: typeof ranked = [];
  for (const e of ranked) {
    const overlaps = kept.some((k) => toTime(e.start) <= toTime(k.end) && toTime(k.start) <= toTime(e.end));
    if (!overlaps) kept.push(e);
  }
  kept.sort((a, b) => (a.end < b.end ? -1 : 1));

  let periods = kept.map((e) => {
    const filingLabel = [...e.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const fiscalYear = filingLabel ?? fiscalYearFromEnd(e.end);
    return { e, fiscalYear };
  });
  // Filing labels must be unique and increasing; otherwise use the date rule for all periods.
  const labels = periods.map((p) => p.fiscalYear);
  const consistent = labels.every((l, i) => i === 0 || l > labels[i - 1]!);
  if (!consistent) periods = periods.map((p) => ({ ...p, fiscalYear: fiscalYearFromEnd(p.e.end) }));

  return periods.map(({ e, fiscalYear }) => ({
    key: `FY${fiscalYear}`,
    label: `FY${fiscalYear}`,
    fiscalYear,
    fiscalQuarter: null,
    start: e.start,
    end: e.end,
    days: daysBetweenInclusive(e.start, e.end),
    kind: "annual" as const,
  }));
}

/**
 * Detect fiscal quarters inside each fiscal year from discrete ~3-month facts and from
 * year-to-date facts (cash-flow statements in 10-Qs are typically YTD only).
 *
 * A completed fiscal year gets quarters only when all three interim period-ends are known.
 * The in-progress fiscal year (after the last 10-K, so no annual period exists yet) gets
 * the consecutive quarters reported so far — the most recent 10-Q data must not be dropped.
 */
export function detectFiscalQuarters(cf: CompanyFactsJson, years: FiscalPeriod[], opts: NormalizeOptions = {}): FiscalPeriod[] {
  const obs = allDurationObservations(cf, opts);
  const out: FiscalPeriod[] = [];

  const interimEnds = (start: string, end: string, days: number) => {
    const fyStart = toTime(start);
    const fyEnd = toTime(end);
    const ends = new Map<1 | 2 | 3, Map<string, number>>([[1, new Map()], [2, new Map()], [3, new Map()]]);
    for (const o of obs) {
      const s = toTime(o.start!);
      const e = toTime(o.end);
      if (s < fyStart || e >= fyEnd) continue;
      const len = daysBetweenInclusive(o.start!, o.end);
      // Index by elapsed share of the fiscal year at the observation's end.
      const elapsed = (e - fyStart) / DAY_MS + 1;
      const q = Math.round((elapsed / days) * 4);
      if (q < 1 || q > 3) continue;
      const discrete = isQuarterDuration(len);
      const ytd = s === fyStart && Math.abs(len - (q * days) / 4) <= 12;
      if (!discrete && !ytd) continue;
      const m = ends.get(q as 1 | 2 | 3)!;
      m.set(o.end, (m.get(o.end) ?? 0) + 1);
    }
    return ([1, 2, 3] as const).map((q) => [...ends.get(q)!.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]);
  };

  const push = (fiscalYear: number, start: string, qEnds: string[]) => {
    let s = start;
    qEnds.forEach((end, i) => {
      const quarter = (i + 1) as 1 | 2 | 3 | 4;
      out.push({
        key: `FY${fiscalYear}-Q${quarter}`,
        label: `Q${quarter} FY${fiscalYear}`,
        fiscalYear,
        fiscalQuarter: quarter,
        start: s,
        end,
        days: daysBetweenInclusive(s, end),
        kind: "quarter",
      });
      s = addDays(end, 1);
    });
  };

  for (const fy of years) {
    const best = interimEnds(fy.start, fy.end, fy.days);
    if (best.some((b) => !b)) continue;
    push(fy.fiscalYear, fy.start, [...(best as string[]), fy.end]);
  }

  const last = years[years.length - 1];
  if (last) {
    const start = addDays(last.end, 1);
    const provisionalEnd = addDays(last.end, last.days);
    const best = interimEnds(start, provisionalEnd, last.days);
    const reported: string[] = [];
    for (const b of best) {
      if (!b) break;
      reported.push(b);
    }
    if (reported.length) push(last.fiscalYear + 1, start, reported);
  }
  return out;
}

// ------------------------------------------------------------------ period values

/** Allowed slack (days) between an observation's start and the expected period start. */
const START_TOLERANCE_DAYS = 7;

function matchDuration(obs: TaggedObservation[], start: string, end: string) {
  const s = toTime(start);
  return obs.filter((o) => o.start && o.end === end && Math.abs(toTime(o.start) - s) <= START_TOLERANCE_DAYS * DAY_MS);
}

function exactInstant(obs: TaggedObservation[], end: string) {
  return obs.filter((o) => !o.start && o.end === end);
}

const notReported = (def: MetricDefinition, period: FiscalPeriod): Cell => ({
  value: null,
  status: "not_reported",
  note: `No ${def.label} observation for ${period.label} (${def.periodType === "instant" ? `as of ${period.end}` : `${period.start} to ${period.end}`}).`,
});

/** Value for a metric in one fiscal period, using the first concept (in priority order) that resolves. */
/** Fiscal-year context needed to derive quarterly values from YTD disclosures. */
export interface QuarterContext {
  /** First day of the fiscal year containing the period. */
  yearStart?: string;
  /** Completed fiscal-year period (absent for the in-progress year). */
  annual?: FiscalPeriod;
  quarters?: FiscalPeriod[];
}

export function periodValue(
  cf: CompanyFactsJson,
  metricId: MetricId,
  period: FiscalPeriod,
  context: QuarterContext,
  opts: NormalizeOptions = {},
): Cell {
  const def = METRICS[metricId];
  let fallback: Cell | null = null;
  for (const c of def.concepts) {
    const obs = observationsFor(cf, c.taxonomy, c.tag, def.unit, opts);
    if (obs.length === 0) continue;
    const cell = resolveWithConcept(def, obs, period, context);
    if (cell.value !== null) return cell;
    if (!fallback || cell.status === "unavailable") fallback = cell;
  }
  return fallback ?? notReported(def, period);
}

function resolveWithConcept(
  def: MetricDefinition,
  obs: TaggedObservation[],
  period: FiscalPeriod,
  context: QuarterContext,
): Cell {
  if (def.periodType === "instant") {
    const pick = pickLatest(exactInstant(obs, period.end));
    return pick ? reportedCell(pick) : notReported(def, period);
  }

  const direct = pickLatest(matchDuration(obs, period.start, period.end));
  if (direct) return reportedCell(direct);
  if (period.kind === "annual") return notReported(def, period);

  // Quarterly derivation from YTD disclosures.
  if (!def.additive) {
    return {
      value: null,
      status: "unavailable",
      note: `${def.label} for ${period.label} is not reported discretely and cannot be derived by subtraction (non-additive metric).`,
    };
  }
  const { annual, yearStart } = context;
  const quarters = context.quarters ?? [];
  if (!yearStart) return notReported(def, period);
  const ytd = (q: number) => {
    const qp = quarters.find((p) => p.fiscalQuarter === q);
    if (!qp) return null;
    if (q === 4) return annual ? pickLatest(matchDuration(obs, annual.start, annual.end)) : null;
    return pickLatest(matchDuration(obs, yearStart, qp.end));
  };
  const q = period.fiscalQuarter!;
  const cur = ytd(q);
  const prev = q === 1 ? null : ytd(q - 1);
  if (cur && (q === 1 || prev)) {
    const value = cur.chosen.val - (prev?.chosen.val ?? 0);
    const curLabel = q === 4 ? "FY" : `YTD through Q${q}`;
    return {
      value,
      status: "derived",
      sources: [toSource(cur.chosen), ...(prev ? [toSource(prev.chosen)] : [])],
      formula: q === 1 ? `${curLabel}` : `${curLabel} − YTD through Q${q - 1}`,
      note: `Derived from cumulative disclosures (${cur.chosen.tag}).`,
    };
  }
  return notReported(def, period);
}

export interface PeriodSeries {
  periods: FiscalPeriod[];
  values: Record<MetricId, Cell[]>;
}

/** Build normalized series for every catalog metric over annual or quarterly periods. */
export function normalizeCompanyFacts(
  cf: CompanyFactsJson,
  frequency: "annual" | "quarterly",
  opts: NormalizeOptions = {},
): PeriodSeries {
  const years = detectFiscalYears(cf, opts);
  const quarters = frequency === "quarterly" ? detectFiscalQuarters(cf, years, opts) : [];
  const periods = frequency === "annual" ? years : quarters;
  const values = {} as Record<MetricId, Cell[]>;
  for (const id of Object.keys(METRICS) as MetricId[]) {
    values[id] = periods.map((p) => {
      if (id === "sharesOutstanding") return coverPageShares(cf, p, opts);
      const annual = years.find((y) => y.fiscalYear === p.fiscalYear);
      const qs = quarters.filter((q) => q.fiscalYear === p.fiscalYear);
      const yearStart = annual?.start ?? qs.find((q) => q.fiscalQuarter === 1)?.start;
      return periodValue(cf, id, p, { annual, quarters: qs, yearStart }, opts);
    });
  }
  return { periods, values };
}

/**
 * Cover-page share counts are dated after the period end (the filing date). Use the
 * latest cover-page observation dated within 120 days after the period end.
 */
function coverPageShares(cf: CompanyFactsJson, period: FiscalPeriod, opts: NormalizeOptions): Cell {
  const def = METRICS.sharesOutstanding;
  for (const c of def.concepts) {
    const obs = observationsFor(cf, c.taxonomy, c.tag, "shares", opts).filter((o) => {
      const lag = (toTime(o.end) - toTime(period.end)) / DAY_MS;
      return !o.start && lag >= 0 && lag <= 120;
    });
    if (obs.length === 0) continue;
    const latestDate = obs.reduce((m, o) => (o.end > m ? o.end : m), obs[0]!.end);
    const pick = pickLatest(obs.filter((o) => o.end === latestDate));
    if (pick) {
      return { ...reportedCell(pick), note: `Cover-page count as of ${latestDate}.` };
    }
  }
  return notReported(def, period);
}
