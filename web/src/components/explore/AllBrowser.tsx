"use client";

/**
 * Explore's first view: everything on the market, to rent and to buy, in one
 * list (owner, 2026-09-29).
 *
 * Somebody arriving on Explore has not said which side they are on, so neither
 * side is chosen for them. Rentals and properties for sale arrive together,
 * newest first, each card saying which it is; the search narrows both. Choosing
 * Rent or Buy in the switch is how to go further — the filters and the map
 * belong to one side each, so they arrive with it.
 *
 * The same masthead, console and pinned band as Rent and Buy, so the three
 * views are one page with a switch rather than three pages.
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { Notice } from "@/components/Notice";
import { ListingCard } from "@/components/listings/ListingCard";
import { Icon } from "@/components/portal/icons";
import { PageHeader } from "@/components/portal/PageHeader";
import { SaleCard } from "@/components/sales/SaleCard";
import { ApiFailure } from "@/lib/api";
import type { Listing } from "@/lib/console";
import { searchPublicListings, searchPublicListingsPage } from "@/lib/listings";
import { searchSales, searchSalesPage, type SaleCard as Sale } from "@/lib/sales";
import { useSession } from "@/lib/session";

type Item =
  | { side: "rent"; at: string; listing: Listing }
  | { side: "sale"; at: string; sale: Sale };

/** Newest first across both, so neither side is always at the bottom. */
function merge(listings: Listing[], sales: Sale[]): Item[] {
  return [
    ...listings.map((listing): Item => ({ side: "rent", at: listing.created_at, listing })),
    ...sales.map((sale): Item => ({ side: "sale", at: sale.listed_at, sale })),
  ].sort((a, b) => b.at.localeCompare(a.at));
}

export function AllBrowser({ modeSwitch }: { modeSwitch: ReactNode }) {
  const { state } = useSession();
  const signedIn = state.status === "signed_in";
  const params = useSearchParams();
  const q = params.get("q") ?? "";

  const [text, setText] = useState(q);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [nextListings, setNextListings] = useState<string | null>(null);
  const [nextSales, setNextSales] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const stick = useRef<HTMLElement | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => { setText(q); }, [q]);

  useEffect(() => {
    const id = ++request.current;
    const timer = setTimeout(async () => {
      const filters = q ? { q } : {};
      const [rent, sale] = await Promise.allSettled([searchPublicListings(filters), searchSales(filters)]);
      if (id !== request.current) return;
      setListings(rent.status === "fulfilled" ? rent.value.results : []);
      setNextListings(rent.status === "fulfilled" ? rent.value.next : null);
      setSales(sale.status === "fulfilled" ? sale.value.results : []);
      setNextSales(sale.status === "fulfilled" ? sale.value.next : null);
      const failed = [rent, sale].find((row) => row.status === "rejected") as PromiseRejectedResult | undefined;
      setError(failed
        ? failed.reason instanceof ApiFailure ? failed.reason.error.message : "Some places could not be loaded."
        : "");
    }, 200);
    return () => clearTimeout(timer);
  }, [q]);

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

  /** The search is the address bar, with no side named: that is what All is. */
  function search(value: string) {
    const next = new URLSearchParams();
    if (value) next.set("q", value);
    window.history.replaceState(null, "", `${window.location.pathname}${next.size ? `?${next.toString()}` : ""}`);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    search(text.trim());
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const [rent, sale] = await Promise.all([
        nextListings ? searchPublicListingsPage(nextListings) : Promise.resolve(null),
        nextSales ? searchSalesPage(nextSales) : Promise.resolve(null),
      ]);
      if (rent) { setListings((current) => [...(current ?? []), ...rent.results]); setNextListings(rent.next); }
      if (sale) { setSales((current) => [...(current ?? []), ...sale.results]); setNextSales(sale.next); }
    } catch {
      setError("We could not load more places.");
    } finally {
      setLoadingMore(false);
    }
  }

  const items = useMemo(() => (listings && sales ? merge(listings, sales) : null), [listings, sales]);
  const rentCount = listings?.length ?? 0;
  const saleCount = sales?.length ?? 0;
  const more = Boolean(nextListings || nextSales);

  const discovery = (
    <div className="explore-discovery all-discovery">
      {modeSwitch}
      <form className="explore-bar" role="search" onSubmit={submit}>
        <label className="explore-search">
          <Icon name="explore" />
          <span className="sr-only">Search places to rent or buy</span>
          <input
            type="search"
            value={text}
            placeholder="Search by area or description"
            onChange={(event) => setText(event.target.value)}
            onBlur={() => { if (q !== text.trim()) search(text.trim()); }}
          />
        </label>
      </form>
    </div>
  );

  return (
    <>
      {signedIn ? (
        <header className="explore-portal-masthead">
          <PageHeader title="Find your next place" description="To rent or to buy, every one verified." />
        </header>
      ) : null}
      <div className={`explore${signedIn ? " explore-portal" : ""}`}>
        {signedIn ? (
          <section ref={(element) => { stick.current = element; }} className={`explore-portal-intro${stuck ? " is-stuck" : ""}`}>
            {discovery}
            <p className="explore-stick-title" aria-hidden="true">Find your next place</p>
          </section>
        ) : (
          <div ref={(element) => { stick.current = element; }} className={`explore-stick${stuck ? " is-stuck" : ""}`}>
            {discovery}
            <p className="explore-stick-title" aria-hidden="true">Find your next place</p>
          </div>
        )}

        {/* What is showing, and the one way to go further: choose a side. */}
        {items ? (
          <div className="explore-all-summary">
            <p>
              <strong>{rentCount}{nextListings ? "+" : ""}</strong> to rent
              <span aria-hidden="true"> · </span>
              <strong>{saleCount}{nextSales ? "+" : ""}</strong> for sale
            </p>
            <p className="type-caption">Choose Rent or Buy for filters and the map.</p>
          </div>
        ) : null}
        {error ? <Notice tone="error" title={error} /> : null}

        <section aria-live="polite" aria-busy={items === null}>
          {items?.length ? (
            <ul className="explore-grid">
              {items.map((item) =>
                item.side === "rent"
                  ? <ListingCard key={`rent-${item.listing.id}`} listing={item.listing} />
                  : <SaleCard key={`sale-${item.sale.id}`} sale={item.sale} />,
              )}
            </ul>
          ) : null}

          {items?.length === 0 && !error ? (
            <div className="explore-empty">
              <p className="type-body-strong">Nothing matches yet</p>
              <p className="type-caption">Try a nearby area, or a shorter search.</p>
            </div>
          ) : null}

          {more ? (
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
