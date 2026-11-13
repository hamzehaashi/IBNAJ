"use client";

/**
 * Workspace state (Zustand).
 *  - `working`: the live model per ticker (in memory; survives switching companies).
 *  - `past` / `future`: undo/redo stacks. Rapid edits of one control coalesce into one step.
 *  - `saved`: explicit snapshots persisted to localStorage via "Save workspace".
 *    (Server-side persistence arrives with user accounts in Phase 4.)
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ForecastAssumptions, ValuationAssumptions } from "@/lib/finance/types";
import { DEFAULT_SCENARIOS, type Scenario } from "@/lib/finance/sensitivity";

export interface ModelState {
  forecast: ForecastAssumptions;
  valuation: ValuationAssumptions;
  scenarios: Scenario[];
}

interface TickerWorkspace {
  working: ModelState;
  past: ModelState[];
  future: ModelState[];
  lastTag: string | null;
  lastAt: number;
}

/** A price the user typed in. Persisted immediately; never presented as market data. */
export interface UserPrice {
  price: number;
  /** ISO date the price applies to. */
  asOf: string;
  enteredAt: number;
}

interface WorkspaceStore {
  workspaces: Record<string, TickerWorkspace>;
  prices: Record<string, UserPrice>;
  setPrice: (ticker: string, price: number, asOf: string) => void;
  clearPrice: (ticker: string) => void;
  saved: Record<string, { state: ModelState; savedAt: number }>;
  recent: string[];
  ensure: (ticker: string, defaults: ModelState) => void;
  update: (ticker: string, fn: (s: ModelState) => ModelState, tag?: string) => void;
  undo: (ticker: string) => void;
  redo: (ticker: string) => void;
  reset: (ticker: string, defaults: ModelState) => void;
  save: (ticker: string) => void;
  visit: (ticker: string) => void;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;
export const STORE_VERSION = 1;

export const initialScenarios = (): Scenario[] => DEFAULT_SCENARIOS.map((s) => ({ ...s, adjustments: { ...s.adjustments } }));

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      workspaces: {},
      prices: {},
      setPrice: (ticker, price, asOf) => set((s) => ({ prices: { ...s.prices, [ticker]: { price, asOf, enteredAt: Date.now() } } })),
      clearPrice: (ticker) =>
        set((s) => {
          const { [ticker]: _removed, ...rest } = s.prices;
          void _removed;
          return { prices: rest };
        }),
      saved: {},
      recent: [],
      ensure: (ticker, defaults) => {
        if (get().workspaces[ticker]) return;
        const saved = get().saved[ticker]?.state;
        set((s) => ({ workspaces: { ...s.workspaces, [ticker]: { working: saved ?? defaults, past: [], future: [], lastTag: null, lastAt: 0 } } }));
      },
      update: (ticker, fn, tag) =>
        set((s) => {
          const ws = s.workspaces[ticker];
          if (!ws) return s;
          const next = fn(ws.working);
          const now = Date.now();
          const coalesce = tag !== undefined && tag === ws.lastTag && now - ws.lastAt < COALESCE_MS;
          return {
            workspaces: {
              ...s.workspaces,
              [ticker]: {
                working: next,
                past: coalesce ? ws.past : [...ws.past, ws.working].slice(-HISTORY_LIMIT),
                future: [],
                lastTag: tag ?? null,
                lastAt: now,
              },
            },
          };
        }),
      undo: (ticker) =>
        set((s) => {
          const ws = s.workspaces[ticker];
          if (!ws || ws.past.length === 0) return s;
          const prev = ws.past[ws.past.length - 1]!;
          return { workspaces: { ...s.workspaces, [ticker]: { ...ws, working: prev, past: ws.past.slice(0, -1), future: [ws.working, ...ws.future], lastTag: null } } };
        }),
      redo: (ticker) =>
        set((s) => {
          const ws = s.workspaces[ticker];
          if (!ws || ws.future.length === 0) return s;
          const [next, ...rest] = ws.future;
          return { workspaces: { ...s.workspaces, [ticker]: { ...ws, working: next!, past: [...ws.past, ws.working], future: rest, lastTag: null } } };
        }),
      reset: (ticker, defaults) => get().update(ticker, () => defaults),
      save: (ticker) =>
        set((s) => {
          const ws = s.workspaces[ticker];
          if (!ws) return s;
          return { saved: { ...s.saved, [ticker]: { state: ws.working, savedAt: Date.now() } } };
        }),
      visit: (ticker) => set((s) => ({ recent: [ticker, ...s.recent.filter((t) => t !== ticker)].slice(0, 8) })),
    }),
    {
      name: "caldun-workspace",
      version: STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ saved: s.saved, recent: s.recent, prices: s.prices }),
      skipHydration: true,
    },
  ),
);
