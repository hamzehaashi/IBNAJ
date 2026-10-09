"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CompanyDataset, MarketSnapshot } from "@/lib/data/types";
import { deriveModelDefaults, type ModelDefaults } from "@/lib/finance/defaults";
import { runDcf } from "@/lib/finance/dcf";
import type { DcfResult } from "@/lib/finance/types";
import { initialScenarios, useWorkspaceStore, type ModelState } from "@/store/workspace";

interface WorkspaceContextValue {
  dataset: CompanyDataset;
  /** Price used everywhere in the workspace: a user-entered price if set, else the dataset snapshot (if any). */
  price: MarketSnapshot | null;
  defaults: ModelDefaults | null;
  defaultsError: string | null;
  hydrated: boolean;
}

const Ctx = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ dataset, children }: { dataset: CompanyDataset; children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const ticker = dataset.profile.ticker;
  const userPrice = useWorkspaceStore((s) => (hydrated ? s.prices[ticker] : undefined));

  const price: MarketSnapshot | null = useMemo(
    () =>
      userPrice
        ? { price: userPrice.price, asOf: userPrice.asOf, currency: dataset.profile.reportingCurrency, source: "Entered by you", freshness: "user_entered", label: "User-entered price" }
        : dataset.market,
    [userPrice, dataset],
  );

  const { defaults, defaultsError } = useMemo(() => {
    try {
      return {
        defaults: deriveModelDefaults({
          annual: dataset.annual,
          quarterly: dataset.quarterly,
          marketPrice: price?.price ?? null,
          marketPriceSource: price ? `${price.label}, as of ${price.asOf}` : undefined,
          riskFree: dataset.riskFree.ok ? dataset.riskFree.quote : null,
          riskFreeNote: dataset.riskFree.ok ? undefined : dataset.riskFree.reason,
          valuationDate: dataset.meta.valuationDate,
        }),
        defaultsError: null,
      };
    } catch (e) {
      return { defaults: null, defaultsError: e instanceof Error ? e.message : String(e) };
    }
  }, [dataset, price]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(useWorkspaceStore.persist.rehydrate()).finally(() => !cancelled && setHydrated(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    useWorkspaceStore.getState().visit(ticker);
    if (defaults) useWorkspaceStore.getState().ensure(ticker, { forecast: defaults.forecast, valuation: defaults.valuation, scenarios: initialScenarios() });
  }, [hydrated, ticker, defaults]);

  const value = useMemo(() => ({ dataset, price, defaults, defaultsError, hydrated }), [dataset, price, defaults, defaultsError, hydrated]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return v;
}

const sameState = (a: ModelState | undefined, b: ModelState | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/**
 * The live model: current assumptions + one DCF run shared by every module.
 * Forecast, DCF, scenarios and the top bar all read this result; nothing recomputes
 * formulas independently.
 */
export function useModel() {
  const { dataset, defaults, price } = useWorkspace();
  const ticker = dataset.profile.ticker;
  const ws = useWorkspaceStore((s) => s.workspaces[ticker]);
  const saved = useWorkspaceStore((s) => s.saved[ticker]);
  const store = useWorkspaceStore;

  const defaultState: ModelState | null = useMemo(
    () => (defaults ? { forecast: defaults.forecast, valuation: defaults.valuation, scenarios: initialScenarios() } : null),
    [defaults],
  );
  const state = ws?.working ?? defaultState;
  // The reference price is workspace-level (user-entered or snapshot), not part of a saved model.
  const valuation = useMemo(() => (state ? { ...state.valuation, referencePrice: price?.price ?? null } : null), [state, price]);

  const result: DcfResult | null = useMemo(
    () => (defaults && state && valuation ? runDcf(defaults.base, state.forecast, valuation) : null),
    [defaults, state, valuation],
  );

  const update = useCallback((fn: (s: ModelState) => ModelState, tag?: string) => store.getState().update(ticker, fn, tag), [store, ticker]);

  return {
    ticker,
    defaults,
    state,
    /** Valuation assumptions with the workspace reference price applied (what the engine actually used). */
    valuation,
    result,
    update,
    undo: () => store.getState().undo(ticker),
    redo: () => store.getState().redo(ticker),
    reset: () => defaultState && store.getState().reset(ticker, defaultState),
    save: () => store.getState().save(ticker),
    canUndo: (ws?.past.length ?? 0) > 0,
    canRedo: (ws?.future.length ?? 0) > 0,
    savedAt: saved?.savedAt ?? null,
    dirty: !!ws && !sameState(ws.working, saved?.state) && (ws.past.length > 0 || !!saved),
  };
}
