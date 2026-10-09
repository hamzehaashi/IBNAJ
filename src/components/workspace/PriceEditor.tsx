"use client";

import { Pencil, X } from "lucide-react";
import { useState } from "react";
import { useWorkspace } from "@/components/workspace/context";
import { Badge, Button } from "@/components/ui/primitives";
import { dateLabel, usd } from "@/lib/format";
import { useWorkspaceStore } from "@/store/workspace";

const today = () => new Date().toISOString().slice(0, 10);

/** Validates a user-entered price and date. Returns an error message, or null when valid. */
export function validateUserPrice(price: string, asOf: string, now = today()): string | null {
  const p = Number(price.replace(/[$,\s]/g, ""));
  if (price.trim() === "" || !Number.isFinite(p)) return "Enter a price.";
  if (p <= 0) return "Price must be greater than zero.";
  if (p > 1_000_000) return "Price looks implausible.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return "Enter the date the price applies to.";
  if (asOf > now) return "Date cannot be in the future.";
  return null;
}

export const freshnessLabel = (f: string) =>
  ({ user_entered: "User-entered", synthetic: "Synthetic", end_of_day: "End-of-day", delayed: "Delayed" })[f] ?? f;

/**
 * Shows the workspace price and lets the user enter or clear their own. A user-entered
 * price is stored in this browser, applies to every module, and is always labeled as such.
 */
export function PriceEditor({ compact }: { compact?: boolean }) {
  const { dataset, price } = useWorkspace();
  const ticker = dataset.profile.ticker;
  const userPrice = useWorkspaceStore((s) => s.prices[ticker]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ price: "", asOf: today() });
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setDraft({ price: price ? price.price.toFixed(2) : "", asOf: userPrice?.asOf ?? today() });
    setError(null);
    setEditing(true);
  };
  const submit = () => {
    const err = validateUserPrice(draft.price, draft.asOf);
    if (err) return setError(err);
    useWorkspaceStore.getState().setPrice(ticker, Number(draft.price.replace(/[$,\s]/g, "")), draft.asOf);
    setEditing(false);
  };

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        aria-label={`Set price for ${ticker}`}
      >
        <span className="text-fg-2">$</span>
        <input
          autoFocus
          inputMode="decimal"
          aria-label="Share price"
          data-testid="price-input"
          value={draft.price}
          onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
          onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
          className="num w-24 rounded border border-accent/40 bg-input px-1.5 py-0.5 text-right text-input-fg outline-none focus:border-accent"
        />
        <label className="flex items-center gap-1 text-[11px] text-fg-2">
          as of
          <input
            type="date"
            aria-label="Price date"
            data-testid="price-date"
            value={draft.asOf}
            max={today()}
            onChange={(e) => setDraft((d) => ({ ...d, asOf: e.target.value }))}
            className="rounded border border-line bg-bg-2 px-1 py-0.5 text-fg"
          />
        </label>
        <Button type="submit" variant="primary" data-testid="price-save">
          Set
        </Button>
        <Button onClick={() => setEditing(false)} aria-label="Cancel">
          <X size={13} />
        </Button>
        {error && (
          <span role="alert" className="basis-full text-[11px] text-neg">
            {error}
          </span>
        )}
      </form>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {price ? (
        <>
          <span className="num font-semibold" data-testid="workspace-price">
            {usd(price.price)}
          </span>
          <Badge tone={price.freshness === "user_entered" ? "accent" : "warn"} title={`${price.label}. ${price.source}. As of ${dateLabel(price.asOf)}. Not live.`}>
            {freshnessLabel(price.freshness)}
            {!compact && ` · ${dateLabel(price.asOf)}`}
          </Badge>
        </>
      ) : (
        <span className="text-fg-2">No price</span>
      )}
      <Button onClick={open} aria-label={price ? "Edit price" : "Enter price"} title="Enter the share price you want Caldun to use" data-testid="price-edit">
        <Pencil size={12} />
        {!compact && <span>{price ? "Edit" : "Enter price"}</span>}
      </Button>
      {userPrice && (
        <Button onClick={() => useWorkspaceStore.getState().clearPrice(ticker)} title={dataset.market ? "Remove your price and use the data snapshot" : "Remove your price"} data-testid="price-clear">
          <X size={12} />
          {!compact && <span>Clear</span>}
        </Button>
      )}
    </span>
  );
}
