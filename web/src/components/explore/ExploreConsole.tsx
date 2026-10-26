"use client";

/**
 * Explore's heading console (owner, 2026-10-05): one glassy search pill with
 * the map beside it, and under it a short row of chips — what to show, then the
 * two or three questions most people ask — with everything else behind "More
 * filters". All, Rent and Buy used to be a segmented bar fused to the search;
 * they are the first chip now, so every view has the same controls in the same
 * places, and the All view has filters and a map like the other two.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/portal/icons";

export type ExploreSide = "all" | "rent" | "buy";

/** A small choice that opens its options in place: "Bedrooms · 2+". */
export function QuickChip({
  label,
  value,
  options,
  onChange,
  emptyValue = "",
  alwaysShowValue = false,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
  /** The option that means "no filter"; the chip reads as off while it is chosen. */
  emptyValue?: string;
  /** Name the choice even when it is the default ("Show · All places"). */
  alwaysShowValue?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const chosen = options.find(([key]) => key === value);
  const active = value !== emptyValue;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="ec-chip-wrap" ref={root}>
      <button
        type="button"
        className={`ec-chip${active ? " is-active" : ""}${open ? " is-open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="ec-chip-label">{label}</span>
        {(active || alwaysShowValue) && chosen ? <span className="ec-chip-value">{chosen[1]}</span> : null}
        <svg className="ec-chip-caret" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="ec-pop" id={id} role="listbox" aria-label={label}>
          {options.map(([key, text]) => (
            <button
              key={key || "any"}
              type="button"
              role="option"
              aria-selected={key === value}
              className="ec-option"
              onClick={() => {
                setOpen(false);
                if (key !== value) onChange(key);
              }}
            >
              <span>{text}</span>
              {key === value ? <Icon name="check" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What Explore shows: everything, rentals, or properties for sale. Switching
 * starts the other side's search fresh — a rent range means nothing to a sale.
 */
export function ShowChip({ side }: { side: ExploreSide }) {
  function go(next: string) {
    const url = next === "all" ? window.location.pathname : `${window.location.pathname}?mode=${next}`;
    window.history.pushState(null, "", url);
  }
  return (
    <QuickChip
      label="Show"
      value={side}
      emptyValue="all"
      alwaysShowValue
      onChange={go}
      options={[["all", "All places"], ["rent", "To rent"], ["buy", "To buy"]]}
    />
  );
}

/** The panel with every filter. Carries the count of what is on. */
export function MoreFiltersButton({
  count,
  open,
  onToggle,
  buttonRef,
  controls,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
  controls: string;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`ec-chip ec-more${count ? " is-active" : ""}${open ? " is-open" : ""}`}
      aria-label={count ? `More filters, ${count} active` : "More filters"}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      <Icon name="filters" />
      <span className="ec-chip-label">More filters</span>
      {count ? <span className="ec-count" aria-hidden="true">{count}</span> : null}
    </button>
  );
}

/** Map or list: the console's one solid act, at the end of the search pill. */
export function MapToggle({ mapView, onToggle }: { mapView: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="explore-map-toggle" onClick={onToggle}>
      <Icon name={mapView ? "listings" : "map"} />
      <span>{mapView ? "List" : "Map"}</span>
    </button>
  );
}

/**
 * One glass bar, one row (owner, 2026-10-05: "keep all the filters on the same
 * row with the search by reducing the width of the search bar"): the search,
 * then the chips, then Map. Narrow screens let the chips wrap under the search.
 */
export function ExploreConsole({ search, map, chips }: { search: ReactNode; map?: ReactNode; chips: ReactNode }) {
  return (
    <div className="ec-console">
      <div className="explore-bar">{search}</div>
      <div className="ec-chips">{chips}</div>
      {map}
    </div>
  );
}

/** Bedrooms, the same scale on both sides: the backend filters `>=`. */
export const BEDROOM_CHOICES = [
  ["", "Any"],
  ["1", "1+"],
  ["2", "2+"],
  ["3", "3+"],
  ["4", "4+"],
] as const;

/** Monthly rent bands in whole cedis, encoded "min-max" (either side may be empty). */
export const RENT_BANDS = [
  ["", "Any rent"],
  ["-1000", "Under GH₵1,000"],
  ["1000-2500", "GH₵1,000 – 2,500"],
  ["2500-5000", "GH₵2,500 – 5,000"],
  ["5000-", "GH₵5,000 and up"],
] as const;

export function rentBand(min: string, max: string): string {
  if (!min && !max) return "";
  const key = `${min}-${max}`;
  return RENT_BANDS.some(([band]) => band === key) ? key : "custom";
}
