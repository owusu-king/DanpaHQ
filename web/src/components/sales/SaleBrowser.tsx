"use client";

/**
 * Explore's Buy side: every property for sale that is public right now.
 *
 * Public means verified and on the market — the backend's rule
 * (`apps.sale.read_models.public_sales`), which this only reads. The search
 * lives in the address bar like Rent's does, under `mode=buy`, so a refresh, a
 * shared link or Back from a property returns the same search.
 *
 * The filters are the ones a buyer here decides on first: what kind of thing,
 * the budget, and the tenure — freehold, leasehold or customary land is a
 * question of what is actually being bought.
 *
 * Its header is Rent's, piece for piece (owner, 2026-09-29): the same console
 * — Rent or Buy, the search, a Filters button carrying the count of what is on
 * — and the same panel the button opens. A row of choices under the search
 * made Buy a different page from Rent.
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Notice } from "@/components/Notice";
import { FilterSelect, SegmentedChoice } from "@/components/explore/FilterFields";
import { ExploreConsole, MoreFiltersButton, QuickChip, ShowChip } from "@/components/explore/ExploreConsole";
import { Icon } from "@/components/portal/icons";
import { PageHeader } from "@/components/portal/PageHeader";
import { ApiFailure } from "@/lib/api";
import {
  searchSales,
  searchSalesPage,
  type SaleCard as Sale,
  type SaleFilters,
  type SaleKind,
  type SaleSort,
  type Tenure,
} from "@/lib/sales";
import { useSession } from "@/lib/session";

import { SaleCard } from "./SaleCard";

const KINDS = [
  ["", "All"],
  ["residential", "Houses"],
  ["commercial", "Commercial"],
  ["land", "Land"],
] as const;

/** Cedis, sent as pesewas. Upper bounds only: "what can I afford" is the question. */
const BUDGETS = [
  ["", "Any budget"],
  ["20000000", "Up to GH₵200k"],
  ["50000000", "Up to GH₵500k"],
  ["100000000", "Up to GH₵1m"],
  ["250000000", "Up to GH₵2.5m"],
  ["500000000", "Up to GH₵5m"],
] as const;

const TENURE_FILTER = [
  ["", "Any tenure"],
  ["freehold", "Freehold"],
  ["leasehold", "Leasehold"],
  ["customary", "Customary land"],
] as const;

const BEDROOMS = [
  ["", "Any"],
  ["1", "1+"],
  ["2", "2+"],
  ["3", "3+"],
  ["4", "4+"],
] as const;

const SORTS = [
  ["newest", "Newest first"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
] as const;

const KEYS = ["q", "kind", "price_max", "bedrooms_min", "tenure", "sort"] as const;

export function SaleBrowser() {
  const { state } = useSession();
  const signedIn = state.status === "signed_in";
  const params = useSearchParams();
  const paramsKey = params.toString();
  const filters = useMemo<SaleFilters>(() => {
    const read = new URLSearchParams(paramsKey);
    const number = (key: string) => (read.get(key) ? Number(read.get(key)) : undefined);
    return {
      q: read.get("q") ?? undefined,
      kind: (read.get("kind") as SaleKind) || undefined,
      price_max: number("price_max"),
      bedrooms_min: number("bedrooms_min"),
      tenure: (read.get("tenure") as Tenure) || undefined,
      sort: (read.get("sort") as SaleSort) || undefined,
    };
  }, [paramsKey]);

  const [sales, setSales] = useState<Sale[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState(filters.q ?? "");
  const [panelOpen, setPanelOpen] = useState(false);
  const request = useRef(0);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const stick = useRef<HTMLElement | null>(null);
  const [stuck, setStuck] = useState(false);

  // Pinned when the sticky console sits at its own `top`, as Rent's does.
  useEffect(() => {
    function measure() {
      const element = stick.current;
      if (!element) return;
      const top = Number.parseFloat(getComputedStyle(element).top) || 0;
      setStuck(window.scrollY > 0 && element.getBoundingClientRect().top <= top + 0.5);
    }
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Whoever opened the panel lands inside it; Escape and a click outside close it.
  useEffect(() => {
    if (!panelOpen) return;
    panel.current?.focus({ preventScroll: true });
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setPanelOpen(false);
      trigger.current?.focus();
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      setPanelOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [panelOpen]);

  useEffect(() => { setText(filters.q ?? ""); }, [filters.q]);

  useEffect(() => {
    const id = ++request.current;
    const timer = setTimeout(async () => {
      try {
        const page = await searchSales(filters);
        if (id !== request.current) return;
        setSales(page.results);
        setNext(page.next);
        setError("");
      } catch (cause) {
        if (id !== request.current) return;
        setSales((current) => current ?? []);
        setNext(null);
        setError(cause instanceof ApiFailure ? cause.error.message : "We could not load properties for sale.");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [filters]);

  /** The search is the address bar; Buy keeps `mode=buy` in it. No history state is copied. */
  function update(patch: Partial<Record<(typeof KEYS)[number], string>>) {
    const current = new URLSearchParams(window.location.search);
    const out = new URLSearchParams({ mode: "buy" });
    for (const key of KEYS) {
      const value = key in patch ? patch[key] : current.get(key);
      if (value) out.set(key, value);
    }
    // Rooms mean nothing for land or a commercial building.
    if (out.get("kind") && out.get("kind") !== "residential") out.delete("bedrooms_min");
    window.history.replaceState(null, "", `${window.location.pathname}?${out.toString()}`);
  }

  function submitText(event: FormEvent) {
    event.preventDefault();
    update({ q: text.trim() });
  }

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await searchSalesPage(next);
      setSales((current) => [...(current ?? []), ...page.results]);
      setNext(page.next);
    } catch {
      setError("We could not load more properties.");
    } finally {
      setLoadingMore(false);
    }
  }

  // What the panel holds, counted once for its button. The search is not one
  // of them: it has its own field, and its own way to clear.
  const filterCount = [
    filters.kind,
    filters.price_max,
    filters.kind === "residential" ? filters.bedrooms_min : undefined,
    filters.tenure,
    filters.sort && filters.sort !== "newest" ? filters.sort : undefined,
  ].filter(Boolean).length;
  const clearFilters = () => update({ kind: "", price_max: "", bedrooms_min: "", tenure: "", sort: "" });
  const count = sales?.length ?? 0;

  const discovery = (
    <div className="explore-discovery sale-discovery">
      <ExploreConsole
        search={(
          <form className="explore-search-form" role="search" onSubmit={submitText}>
            <label className="explore-search sale-search">
              <Icon name="explore" />
              <span className="sr-only">Search properties for sale</span>
              <input
                type="search"
                value={text}
                placeholder="Search by area or description"
                onChange={(event) => setText(event.target.value)}
                onBlur={() => { if ((filters.q ?? "") !== text.trim()) update({ q: text.trim() }); }}
              />
            </label>
          </form>
        )}
        chips={(
          <>
            <ShowChip side="buy" />
            <QuickChip label="What" value={filters.kind ?? ""} onChange={(value) => update({ kind: value })} options={KINDS} />
            <QuickChip
              label="Budget"
              value={filters.price_max ? String(filters.price_max) : ""}
              onChange={(value) => update({ price_max: value })}
              options={BUDGETS}
            />
            <MoreFiltersButton
              buttonRef={trigger}
              count={filterCount}
              open={panelOpen}
              controls="sale-filters-panel"
              onToggle={() => setPanelOpen((open) => !open)}
            />
          </>
        )}
      />

      {panelOpen ? (
        <>
          <div className="explore-filter-scrim" aria-hidden="true" />
          <div
            ref={panel}
            id="sale-filters-panel"
            className="explore-advanced"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sale-filter-heading"
            tabIndex={-1}
          >
            <div className="explore-advanced-head">
              <h2 id="sale-filter-heading" className="type-title-2">Filters</h2>
              <button
                type="button"
                className="explore-icon-button"
                aria-label="Close filters"
                onClick={() => { setPanelOpen(false); trigger.current?.focus(); }}
              ><Icon name="close" /></button>
            </div>
            <div className="explore-advanced-body">
              <div className="explore-filter-grid sale-filter-grid">
                <SegmentedChoice
                  name="sale-kind"
                  label="What"
                  value={filters.kind ?? ""}
                  onChange={(value) => update({ kind: value })}
                  options={KINDS}
                />
                {filters.kind === "residential" ? (
                  <SegmentedChoice
                    name="sale-bedrooms"
                    label="Bedrooms"
                    value={filters.bedrooms_min ? String(filters.bedrooms_min) : ""}
                    onChange={(value) => update({ bedrooms_min: value })}
                    options={BEDROOMS}
                  />
                ) : null}
                <FilterSelect
                  name="sale-budget"
                  label="Budget"
                  value={filters.price_max ? String(filters.price_max) : ""}
                  onChange={(value) => update({ price_max: value })}
                  options={BUDGETS}
                />
                <FilterSelect
                  name="sale-tenure"
                  label="Tenure"
                  value={filters.tenure ?? ""}
                  onChange={(value) => update({ tenure: value })}
                  options={TENURE_FILTER}
                />
                <FilterSelect
                  name="sale-sort"
                  label="Sort by"
                  value={filters.sort ?? "newest"}
                  onChange={(value) => update({ sort: value === "newest" ? "" : value })}
                  options={SORTS}
                />
              </div>
            </div>
            <div className="explore-advanced-actions">
              <button
                type="button"
                className="explore-text-button"
                disabled={!filterCount}
                onClick={() => { clearFilters(); panel.current?.focus({ preventScroll: true }); }}
              >Clear all</button>
              <button
                type="button"
                className="btn btn-primary explore-show-results"
                onClick={() => { setPanelOpen(false); trigger.current?.focus(); }}
              >{sales === null ? "Updating…" : `Show ${count}${next ? "+" : ""} ${count === 1 ? "property" : "properties"}`}</button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );

  return (
    <>
    {/* As on Rent: the title scrolls away, only the console sticks. */}
    {signedIn ? (
      <header className="explore-portal-masthead">
        <PageHeader title="Buy a property" description="Verified for sale, the title checked by our team." />
      </header>
    ) : null}
    <div className={`explore${signedIn ? " explore-portal" : ""}`}>
      {signedIn ? (
        <section ref={(element) => { stick.current = element; }} className={`explore-portal-intro${stuck ? " is-stuck" : ""}`}>
          {discovery}
          <p className="explore-stick-title" aria-hidden="true">Buy a property</p>
        </section>
      ) : (
        <div ref={(element) => { stick.current = element; }} className={`explore-stick${stuck ? " is-stuck" : ""}`}>
          {discovery}
          <p className="explore-stick-title" aria-hidden="true">Buy a property</p>
        </div>
      )}

      {filterCount ? (
        <div className="explore-feedback">
          <button
            type="button"
            className="explore-clear-all"
            onClick={() => { clearFilters(); trigger.current?.focus(); }}
          >Clear all</button>
        </div>
      ) : null}
      {error ? <Notice tone="error" title={error} /> : null}

      <section aria-live="polite" aria-busy={sales === null}>
        {sales?.length ? (
          <ul className="explore-grid">
            {sales.map((sale) => <SaleCard key={sale.id} sale={sale} />)}
          </ul>
        ) : null}

        {sales?.length === 0 && !error ? (
          <div className="explore-empty">
            <p className="type-body-strong">Nothing for sale matches yet</p>
            <p className="type-caption">Try a higher budget, another kind of property, or a wider area.</p>
          </div>
        ) : null}

        {next ? (
          <p style={{ marginTop: "var(--space-6)" }}>
            <button type="button" className="explore-more" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Loading…" : "Show more"}
            </button>
          </p>
        ) : null}
      </section>
    </div>
    </>
  );
}
