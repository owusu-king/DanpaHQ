"use client";

/**
 * Explore's first view: everything on the market, to rent and to buy, in one
 * list (owner, 2026-09-29) — and now with filters and a map like the other two
 * (owner, 2026-10-05: "default 'all' view does not show filter and map").
 *
 * Somebody arriving on Explore has not said which side they are on, so neither
 * side is chosen for them. The filters here are the ones both sides answer the
 * same way — where, what kind of property, how many bedrooms — and the map
 * shows the rentals' price markers with the sales as their own pins. Choosing
 * Show → To rent or To buy is how to reach each side's own questions: a rent
 * band means nothing to a sale.
 *
 * The search is the address bar (`exploreQuery`), as on Rent, so place, map and
 * back/forward behave the same on both.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Notice } from "@/components/Notice";
import { ListingCard } from "@/components/listings/ListingCard";
import { Icon } from "@/components/portal/icons";
import { PageHeader } from "@/components/portal/PageHeader";
import { SaleCard } from "@/components/sales/SaleCard";
import { ApiFailure, isAborted } from "@/lib/api";
import type { Listing } from "@/lib/console";
import {
  listingSearchParams,
  parseExploreQuery,
  serializeExploreQuery,
  type ExploreQuery,
} from "@/lib/exploreQuery";
import { searchPublicListingsPage } from "@/lib/listings";
import { searchListingsFor } from "@/lib/mapSearch";
import type { GeoBounds, ResolvedPlace } from "@/lib/places";
import { searchSales, searchSalesPage, type SaleCard as Sale, type SaleFilters, type SaleKind } from "@/lib/sales";
import { useSession } from "@/lib/session";

import {
  BEDROOM_CHOICES,
  ExploreConsole,
  MapToggle,
  QuickChip,
  ShowChip,
} from "./ExploreConsole";
import { ExploreMapView } from "./ExploreMapView";
import { PlaceSearch } from "./PlaceSearch";

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

/** The kinds both sides share. Hostels are only let and land only sold, so each lives on its own side. */
const TYPES = [
  ["", "Any type"],
  ["residential", "Homes"],
  ["commercial", "Commercial"],
] as const;

const NO_LOCATION: Partial<ExploreQuery> = { area: null, q: "", bbox: null, localityId: "", localityName: "" };

export function AllBrowser() {
  const router = useRouter();
  const { state } = useSession();
  const signedIn = state.status === "signed_in";
  const params = useSearchParams();
  const paramsKey = params.toString();
  const query = useMemo(() => {
    const parsed = parseExploreQuery(new URLSearchParams(paramsKey));
    // Only the filters both sides answer; a link from Rent's panel keeps its place, not its rent band.
    return {
      ...parsed,
      propertyType: TYPES.some(([value]) => value === parsed.propertyType) ? parsed.propertyType : "",
      spaceType: "",
      rentMin: "",
      rentMax: "",
      advanceMax: "",
      furnished: false,
      sort: "newest" as const,
    };
  }, [paramsKey]);
  const search = useMemo(() => listingSearchParams(query).toString(), [query]);
  const mapView = query.view === "map";

  const saleFilters = useMemo<SaleFilters>(() => {
    const box = query.bbox ?? query.area?.bounds ?? null;
    return {
      ...(box ? { west: box.west, south: box.south, east: box.east, north: box.north } : {}),
      ...(!box && query.localityId ? { locality_id: query.localityId } : {}),
      ...(!query.area && !query.localityId && query.q.trim() ? { q: query.q.trim() } : {}),
      ...(query.propertyType ? { kind: query.propertyType as SaleKind } : {}),
      ...(query.bedrooms ? { bedrooms_min: Number(query.bedrooms) } : {}),
    };
  }, [query]);
  const saleKey = JSON.stringify(saleFilters);

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [nextListings, setNextListings] = useState<string | null>(null);
  const [nextSales, setNextSales] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const stick = useRef<HTMLElement | null>(null);
  const [stuck, setStuck] = useState(false);

  /** Write the search back to the address bar, as Rent does; All never names a side. */
  const update = useCallback((patch: Partial<ExploreQuery>, mode: "push" | "replace" = "replace") => {
    const current = parseExploreQuery(new URLSearchParams(window.location.search));
    const next = serializeExploreQuery({ ...current, ...patch });
    const url = `${window.location.pathname}${next.size ? `?${next.toString()}` : ""}`;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  // Both sides follow the controls; a slower earlier answer never replaces a newer one.
  useEffect(() => {
    const id = ++request.current;
    const controller = new AbortController();
    setQuerying(true);
    const timer = setTimeout(async () => {
      const [rent, sale] = await Promise.allSettled([
        searchListingsFor(new URLSearchParams(search), controller.signal),
        searchSales(JSON.parse(saleKey) as SaleFilters),
      ]);
      if (id !== request.current) return;
      if (rent.status === "rejected" && isAborted(rent.reason)) return;
      setListings(rent.status === "fulfilled" ? rent.value.results : (current) => current ?? []);
      setNextListings(rent.status === "fulfilled" ? rent.value.next : null);
      setSales(sale.status === "fulfilled" ? sale.value.results : (current) => current ?? []);
      setNextSales(sale.status === "fulfilled" ? sale.value.next : null);
      const failed = [rent, sale].find((row) => row.status === "rejected") as PromiseRejectedResult | undefined;
      setError(failed
        ? failed.reason instanceof ApiFailure ? failed.reason.error.message : "Some places could not be loaded."
        : "");
      setQuerying(false);
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, saleKey]);

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

  function choosePlace(place: ResolvedPlace) {
    const area = { name: place.display_name, bounds: place.bounds, ref: `${place.provider}:${place.reference}` };
    update({ ...NO_LOCATION, area, view: "map" }, mapView ? "replace" : "push");
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
  const filterCount = [query.propertyType, query.bedrooms].filter(Boolean).length;

  const discovery = (
    <div className="explore-discovery all-discovery">
      <ExploreConsole
        search={(
          <PlaceSearch
            label="Search places to rent or buy"
            area={query.area}
            text={query.area ? "" : query.localityName || query.q}
            onChoosePlace={choosePlace}
            onSubmitText={(text) => update({ ...NO_LOCATION, q: text })}
            onClear={() => update(NO_LOCATION)}
          />
        )}
        map={<MapToggle mapView={mapView} onToggle={() => update({ view: mapView ? "list" : "map" }, mapView ? "replace" : "push")} />}
        chips={(
          <>
            <ShowChip side="all" />
            <QuickChip label="Type" value={query.propertyType} onChange={(value) => update({ propertyType: value })} options={TYPES} />
            <QuickChip label="Bedrooms" value={query.bedrooms} onChange={(value) => update({ bedrooms: value })} options={BEDROOM_CHOICES} />
            {filterCount ? (
              <button type="button" className="ec-clear" onClick={() => update({ propertyType: "", bedrooms: "" })}>Clear</button>
            ) : null}
          </>
        )}
      />
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

        {items ? (
          <div className="explore-all-summary">
            <p>
              <strong>{rentCount}{nextListings ? "+" : ""}</strong> to rent
              <span aria-hidden="true"> · </span>
              <strong>{saleCount}{nextSales ? "+" : ""}</strong> for sale
              {query.area ? <> in {query.area.name.split(",")[0]}</> : null}
            </p>
          </div>
        ) : null}
        {error ? <Notice tone="error" title={error} /> : null}

        {mapView ? (
          <ExploreMapView
            query={query}
            search={search}
            area={query.area}
            listings={listings}
            next={nextListings}
            loadingMore={loadingMore}
            querying={querying}
            savedIds={new Set()}
            onLoadMore={() => void loadMore()}
            onOpenListing={() => undefined}
            onSearchArea={(bounds: GeoBounds) => update({ bbox: bounds })}
            onClearFilters={() => update({ propertyType: "", bedrooms: "" })}
            hasFilters={filterCount > 0}
            sales={sales}
            onOpenSale={(id) => router.push(`/record/sale?id=${id}` as never)}
          />
        ) : (
          <section aria-live="polite" aria-busy={items === null || querying}>
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
                <p className="type-caption">Try a nearby area, or fewer filters.</p>
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
        )}

        {/* A phone's switch between the two views, as on Rent. */}
        <button
          type="button"
          className="explore-view-switch"
          onClick={() => update({ view: mapView ? "list" : "map" }, mapView ? "replace" : "push")}
        >
          <Icon name={mapView ? "listings" : "map"} />
          <span>{mapView ? "List" : "Map"}</span>
        </button>
      </div>
    </>
  );
}
