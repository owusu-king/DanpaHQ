"use client";

import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { Notice } from "@/components/Notice";
import { ListingCard } from "@/components/listings/ListingCard";
import { ExploreMapView } from "@/components/explore/ExploreMapView";
import { FilterSelect, RentRange, SegmentedChoice } from "@/components/explore/FilterFields";
import { PlaceSearch } from "@/components/explore/PlaceSearch";
import {
  BEDROOM_CHOICES,
  ExploreConsole,
  MapToggle,
  MoreFiltersButton,
  QuickChip,
  RENT_BANDS,
  ShowChip,
  rentBand,
} from "@/components/explore/ExploreConsole";
import { ApiFailure, isAborted } from "@/lib/api";
import type { Listing } from "@/lib/console";
import {
  listingSearchParams,
  parseExploreQuery,
  refinementCount,
  serializeExploreQuery,
  withoutFilters,
  type ExploreQuery,
} from "@/lib/exploreQuery";
import { listSavedListings } from "@/lib/tenant";
import {
  savePublicListing,
  searchPublicListingsPage,
  unsavePublicListing,
  type ListingSort,
} from "@/lib/listings";
import { searchListingsFor } from "@/lib/mapSearch";
import type { GeoBounds, ResolvedPlace } from "@/lib/places";
import { loadPropertyTypes, type PropertyTypeOption } from "@/lib/propertyTypes";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/toast/Toaster";
import { Switch } from "@/components/Check";
import { Icon } from "@/components/portal/icons";
import { PageHeader } from "@/components/portal/PageHeader";

/**
 * One listing experience, hosted by two chromes.
 *
 * The public site and the portal's Explore are the same search, cards and query
 * logic — only the shell and the copy above differ. A second implementation is
 * how the two would drift, and the public page is the one that must never break.
 *
 * The shape of the screen is search → scan → compare → open. A photograph does
 * the recognizing and the price does the comparing, so the card gives room to
 * those two and one line to everything else. Verification is reassurance, not
 * the headline: one quiet mark rather than a row of stamps beside the rent.
 *
 * The search lives in the address bar (`exploreQuery`). The bar, the panel, the
 * cards, the map and the count all read it and write it back, so none of them
 * keeps a copy to fall out of step, and opening the map, closing it, leaving for
 * a listing, refreshing or sharing the link all return the same search. Choosing
 * a place opens the map on it; the map is a view of the search, never its owner.
 *
 * The controls are one search bar and one Filters button — the pair the phone
 * floats over its map. Place lives in the bar, which owns the only clear for it;
 * rent, type, unit, bedrooms, advance, furnishing and order live in the panel
 * the button opens, and the button carries the count of what is on. A rail of
 * quick pills and a row of chips used to repeat what the panel holds.
 */

/** `bedrooms_min=0` matched every listing — the backend filters `>=` — so a
 * "Single room / studio" choice was Any under another name. Rooms and studios
 * are Unit types, and are chosen there. */
const BEDROOMS = [
  ["", "Any"],
  ["1", "1+"],
  ["2", "2+"],
  ["3", "3+"],
] as const;

/** Advance is the question that decides whether a place is possible at all. */
const ADVANCE = [
  ["", "Any"],
  ["6", "Up to 6 months"],
  ["12", "Up to 1 year"],
  ["24", "Up to 2 years"],
] as const;

const SORTS: ReadonlyArray<readonly [ListingSort, string]> = [
  ["newest", "Newest first"],
  ["rent_asc", "Rent: low to high"],
  ["rent_desc", "Rent: high to low"],
];

/** Place is not a filter: clearing filters keeps it, and choosing one clears the others' area. */
const NO_LOCATION: Partial<ExploreQuery> = { area: null, q: "", bbox: null, localityId: "", localityName: "" };

export function ListingBrowser() {
  const { state } = useSession();
  const { toast } = useToast();
  const signedIn = state.status === "signed_in";

  const params = useSearchParams();
  const paramsKey = params.toString();
  const query = useMemo(() => parseExploreQuery(new URLSearchParams(paramsKey)), [paramsKey]);
  const search = useMemo(() => listingSearchParams(query).toString(), [query]);
  const mapView = query.view === "map";

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState("");
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[]>([]);
  const [rentMinDraft, setRentMinDraft] = useState(query.rentMin);
  const [rentMaxDraft, setRentMaxDraft] = useState(query.rentMax);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [saved, setSaved] = useState<Set<string>>(new Set());
  const requestId = useRef(0);
  const advancedPanel = useRef<HTMLDivElement>(null);
  const advancedTrigger = useRef<HTMLButtonElement>(null);
  const advancedClose = useRef<HTMLButtonElement>(null);
  const advancedShow = useRef<HTMLButtonElement>(null);
  const exploreRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef<HTMLDivElement>(null);
  const stickLine = useRef<HTMLDivElement>(null);
  const viewShown = useRef(false);
  const [stuck, setStuck] = useState(false);

  /**
   * Write the search back to the address bar. Read from `window.location`, not
   * from the render's `query`, so two changes in one event compose instead of
   * the second undoing the first. Pushing makes Back undo it (opening the map);
   * replacing keeps adjustments from building a trail somebody has to walk back.
   */
  const update = useCallback((patch: Partial<ExploreQuery>, mode: "push" | "replace" = "replace") => {
    const current = parseExploreQuery(new URLSearchParams(window.location.search));
    const nextParams = serializeExploreQuery({ ...current, ...patch });
    if (new URLSearchParams(window.location.search).get("mode") === "rent") nextParams.set("mode", "rent");
    const url = `${window.location.pathname}${nextParams.size ? `?${nextParams.toString()}` : ""}`;
    // No state, and never a copy of this entry's: Next marks its own entries
    // with `__NA` and lets any write carrying the mark through unsynced, so the
    // address bar moved and useSearchParams never heard. Next copies its keys
    // across itself, and `rentalsReturn` belonged to the search being left.
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  }, []);

  const spaceTypes = useMemo(() => {
    const source = query.propertyType
      ? propertyTypes.filter((type) => type.value === query.propertyType)
      : propertyTypes;
    const unique = new Map<string, string>();
    for (const type of source) {
      for (const space of type.space_types) unique.set(space.value, space.label);
    }
    return [...unique].map(([value, label]) => ({ value, label }));
  }, [query.propertyType, propertyTypes]);

  // Leaving for a listing. The address bar already is the search; what is left
  // to keep is how far down it the tenant had scrolled.
  function rememberExplorePosition() {
    sessionStorage.setItem("rentals:return-scroll", String(window.scrollY));
    window.history.replaceState(
      { ...window.history.state, rentalsReturn: true },
      "",
      window.location.href,
    );
  }

  useEffect(() => {
    if (listings === null) return;
    const stored = sessionStorage.getItem("rentals:return-scroll");
    const shouldRestore = Boolean(window.history.state?.rentalsReturn);
    if (!stored || !shouldRestore) {
      sessionStorage.removeItem("rentals:return-scroll");
      return;
    }
    sessionStorage.removeItem("rentals:return-scroll");
    const historyState = { ...window.history.state };
    delete historyState.rentalsReturn;
    window.history.replaceState(historyState, "", window.location.href);
    requestAnimationFrame(() => window.scrollTo({ top: Number(stored), behavior: "auto" }));
  }, [listings]);

  // Public discovery keeps its controls in reach. In the portal, the complete
  // introduction is the sticky unit, so its title and controls never separate.
  useEffect(() => {
    const stick = stickRef.current;
    const line = stickLine.current;
    if (!stick || !line) return;
    let stickTop = 0;
    const measure = () => setStuck(line.getBoundingClientRect().top < stickTop - 1);
    const place = () => {
      stickTop = Number.parseFloat(getComputedStyle(stick).top) || 0;
      measure();
    };
    place();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", place);
    };
  }, []);

  // The map sticks beneath the search, so it has to know how tall the search
  // is: a map area chip or a wrapped row changes that.
  useEffect(() => {
    const stick = stickRef.current;
    const explore = exploreRef.current;
    if (!stick || !explore) return;
    const publish = () => explore.style.setProperty("--explore-tray-height", `${Math.ceil(stick.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(stick);
    return () => observer.disconnect();
  }, []);

  // Opening the map brings it into view: the search rises to where it sticks
  // under the header and the map fills the screen below it, instead of starting
  // below the fold beneath the page's introduction. Arriving on a map link
  // jumps, as an anchor does — a smooth scroll does not move a tab that is not
  // being shown — and switching glides. A search already stuck stays where it
  // is, and a return from a listing keeps its own place.
  useEffect(() => {
    const arriving = !viewShown.current;
    viewShown.current = true;
    if (!mapView || window.history.state?.rentalsReturn) return;
    const stick = stickRef.current;
    const line = stickLine.current;
    if (!stick || !line) return;
    const distance = line.getBoundingClientRect().top - (Number.parseFloat(getComputedStyle(stick).top) || 0);
    if (distance <= 8) return;
    window.scrollTo({ top: window.scrollY + distance, behavior: arriving ? "instant" : "smooth" });
  }, [mapView]);

  // Results follow the controls. Nothing here waits for a Search button — the
  // old form made every adjustment a round trip through a submit.
  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    setQuerying(true);
    const timer = setTimeout(async () => {
      try {
        const page = await searchListingsFor(new URLSearchParams(search), controller.signal);
        // A slower earlier request must never overwrite a newer answer.
        if (id !== requestId.current) return;
        setListings(page.results);
        setNext(page.next);
        setError("");
        setQuerying(false);
      } catch (cause) {
        if (isAborted(cause) || id !== requestId.current) return;
        // The search is kept, and so are the last results: a failed request says
        // so rather than emptying the page as though nothing matched.
        setListings((current) => current ?? []);
        setNext(null);
        setError(cause instanceof ApiFailure ? cause.error.message : "We could not load rentals.");
        setQuerying(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  useEffect(() => {
    void loadPropertyTypes().then(setPropertyTypes).catch(() => setPropertyTypes([]));
  }, []);

  // Rent moves a stop at a time as a thumb is dragged, so the range keeps the
  // draft and the search takes it once the dragging settles.
  useEffect(() => { setRentMinDraft(query.rentMin); }, [query.rentMin]);
  useEffect(() => { setRentMaxDraft(query.rentMax); }, [query.rentMax]);
  useEffect(() => {
    if (rentMinDraft === query.rentMin && rentMaxDraft === query.rentMax) return;
    const timer = setTimeout(() => update({ rentMin: rentMinDraft, rentMax: rentMaxDraft }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentMinDraft, rentMaxDraft]);

  // Whoever opened the panel lands inside it, not on the trigger behind it.
  useEffect(() => {
    if (advancedOpen) advancedPanel.current?.focus({ preventScroll: true });
  }, [advancedOpen]);

  useEffect(() => {
    if (!advancedOpen) return;
    function closeFromKeyboard(event: KeyboardEvent) {
      // An open list inside the panel uses Escape to close itself, and says so.
      // React listens on the document too, so stopping propagation cannot keep
      // the key from here.
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setAdvancedOpen(false);
      advancedTrigger.current?.focus();
    }
    function closeFromOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (advancedPanel.current?.contains(target) || advancedTrigger.current?.contains(target)) return;
      setAdvancedOpen(false);
    }
    document.addEventListener("keydown", closeFromKeyboard);
    document.addEventListener("pointerdown", closeFromOutside);
    return () => {
      document.removeEventListener("keydown", closeFromKeyboard);
      document.removeEventListener("pointerdown", closeFromOutside);
    };
  }, [advancedOpen]);

  // Narrow widths show the panel as a sheet over a scrim, so the page behind it
  // must not scroll. The root keeps its reserved scrollbar gutter, so nothing
  // moves sideways when the lock goes on.
  useEffect(() => {
    if (!advancedOpen || !window.matchMedia("(max-width: 63.999rem)").matches) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = previous; };
  }, [advancedOpen]);

  useEffect(() => {
    if (!signedIn) return;
    void listSavedListings()
      .then((rows) => setSaved(new Set(rows.map((row) => row.listing.id))))
      .catch(() => undefined);
  }, [signedIn]);

  const filterCount = refinementCount(query);

  const showLabel = listings === null || querying ? "Updating rentals..." : "Show rentals";

  function changePropertyType(value: string) {
    const allowed = propertyTypes.find((type) => type.value === value)?.space_types ?? [];
    const keepSpace = !value || !query.spaceType || allowed.some((space) => space.value === query.spaceType);
    update({ propertyType: value, spaceType: keepSpace ? query.spaceType : "" });
  }

  // Filters, not place: the search bar owns the one clear for that.
  function clearFilters() {
    update(withoutFilters(query));
  }

  function choosePlace(place: ResolvedPlace) {
    // Choosing a place opens the map on it. Pushed, so Back returns to the list.
    // The place travels whole, so neither a refresh nor a shared link resolves it again.
    const area = { name: place.display_name, bounds: place.bounds, ref: `${place.provider}:${place.reference}` };
    update({ ...NO_LOCATION, area, view: "map" }, query.view === "map" ? "replace" : "push");
  }

  // Opening the map is pushed, so Back returns to the list; returning to the
  // list changes the view and nothing else.
  function showMap() { update({ view: "map" }, "push"); }
  function showList() { update({ view: "list" }); }

  function closeAdvanced() {
    setAdvancedOpen(false);
    advancedTrigger.current?.focus();
  }

  // A dialog keeps Tab inside itself. Without this, focus walked out of the
  // panel onto the listing cards it was covering.
  function keepFocusInPanel(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const first = advancedClose.current;
    const last = advancedShow.current;
    if (!first || !last) return;
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === event.currentTarget)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await searchPublicListingsPage(next);
      setListings((current) => [...(current ?? []), ...page.results]);
      setNext(page.next);
    } catch {
      setError("We could not load more rentals.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function toggleSave(listing: Listing) {
    const has = saved.has(listing.id);
    // Optimistic: shortlisting is private and reversible, so a wrong guess
    // costs nothing and waiting costs the feel of the whole page.
    setSaved((current) => {
      const nextSet = new Set(current);
      if (has) nextSet.delete(listing.id); else nextSet.add(listing.id);
      return nextSet;
    });
    try {
      await (has ? unsavePublicListing(listing.id) : savePublicListing(listing.id));
    } catch {
      setSaved((current) => {
        const nextSet = new Set(current);
        if (has) nextSet.add(listing.id); else nextSet.delete(listing.id);
        return nextSet;
      });
      // The optimistic heart has just flipped back on its own. Without this the
      // only signal that anything failed is a control quietly returning to
      // where it started, which reads as a mis-tap rather than an error — and
      // the usual response to that is to tap it again.
      toast({
        tone: "error",
        title: has ? "Could not remove that listing" : "Could not save that listing",
        description: "Check your connection and try again.",
      });
    }
  }

  function discovery(): ReactNode {
    return (
      <div className="explore-discovery">
        {/* The search pill, then a few chips; everything else is behind More
            filters (owner, 2026-10-05). Show is the first chip on every side. */}
        <ExploreConsole
          search={(
            <PlaceSearch
              label="Search by location or property"
              area={query.area}
              text={query.area ? "" : query.localityName || query.q}
              onChoosePlace={choosePlace}
              onSubmitText={(text) => update({ ...NO_LOCATION, q: text })}
              onClear={() => update(NO_LOCATION)}
            />
          )}
          map={<MapToggle mapView={mapView} onToggle={mapView ? showList : showMap} />}
          chips={(
            <>
              <ShowChip side="rent" />
              <QuickChip
                label="Bedrooms"
                value={query.bedrooms}
                onChange={(value) => update({ bedrooms: value })}
                options={BEDROOM_CHOICES}
              />
              <QuickChip
                label="Rent"
                value={rentBand(query.rentMin, query.rentMax)}
                onChange={(value) => {
                  const [minimum = "", maximum = ""] = value.split("-");
                  update({ rentMin: minimum, rentMax: maximum });
                }}
                options={rentBand(query.rentMin, query.rentMax) === "custom"
                  ? [...RENT_BANDS, ["custom", "Custom range"] as const]
                  : RENT_BANDS}
              />
              <MoreFiltersButton
                buttonRef={advancedTrigger}
                count={filterCount}
                open={advancedOpen}
                controls="explore-advanced-filters"
                onToggle={() => setAdvancedOpen((open) => !open)}
              />
            </>
          )}
        />

        {advancedOpen ? (
          <>
            <div className="explore-filter-scrim" aria-hidden="true" />
            <div
              ref={advancedPanel}
              id="explore-advanced-filters"
              className="explore-advanced"
              role="dialog"
              aria-modal="true"
              aria-labelledby="explore-filter-heading"
              tabIndex={-1}
              onKeyDown={keepFocusInPanel}
            >
              <div className="explore-advanced-head">
                <h2 id="explore-filter-heading" className="type-title-2">Filters</h2>
                <button
                  ref={advancedClose}
                  type="button"
                  className="explore-icon-button"
                  aria-label="Close filters"
                  onClick={closeAdvanced}
                ><Icon name="close" /></button>
              </div>

              <div className="explore-advanced-body">
                {/* The phone's rows, paired two to a line where the panel has the
                    room: rent across the top, then the rest in the phone's order. */}
                <RentRange
                  minimum={rentMinDraft}
                  maximum={rentMaxDraft}
                  onChange={(minimum, maximum) => { setRentMinDraft(minimum); setRentMaxDraft(maximum); }}
                />
                <div className="explore-filter-grid">
                  <FilterSelect
                    name="explore-property-type"
                    label="Property type"
                    value={query.propertyType}
                    onChange={changePropertyType}
                    options={[["", "Any"] as const, ...propertyTypes.map((type) => [type.value, type.label] as const)]}
                  />
                  <FilterSelect
                    name="explore-space-type"
                    label="Unit type"
                    value={query.spaceType}
                    onChange={(value) => update({ spaceType: value })}
                    options={[["", "Any"] as const, ...spaceTypes.map((space) => [space.value, space.label] as const)]}
                  />
                  <SegmentedChoice
                    name="explore-bedrooms"
                    label="Bedrooms"
                    value={query.bedrooms}
                    onChange={(value) => update({ bedrooms: value })}
                    options={BEDROOMS}
                  />
                  <FilterSelect
                    name="explore-advance"
                    label="Maximum advance"
                    value={query.advanceMax}
                    onChange={(value) => update({ advanceMax: value })}
                    options={ADVANCE}
                  />
                  {/* On or off, so a switch: a tick reads as one answer of several. */}
                  <label className="explore-filter-cell explore-switch-row">
                    <span className="explore-filter-label">Furnished only</span>
                    <span className="explore-switch">
                      <Switch checked={query.furnished} onChange={(checked) => update({ furnished: checked })} label="Furnished only" />
                    </span>
                  </label>
                  <FilterSelect
                    name="explore-sort"
                    label="Sort by"
                    value={query.sort}
                    onChange={(value) => update({ sort: value as ListingSort })}
                    options={SORTS}
                  />
                </div>
              </div>

              <div className="explore-advanced-actions">
                <button
                  type="button"
                  className="explore-text-button"
                  disabled={!filterCount}
                  onClick={() => { clearFilters(); advancedPanel.current?.focus({ preventScroll: true }); }}
                >Clear all</button>
                <button
                  ref={advancedShow}
                  type="button"
                  className="btn btn-primary explore-show-results"
                  onClick={closeAdvanced}
                >{showLabel}</button>
              </div>
            </div>
          </>
        ) : null}

      </div>
    );
  }

  function resultsFeedback(): ReactNode {
    if (!query.bbox && !filterCount) return null;
    return (
      <div className="explore-feedback">
          {/* An area drawn on the map narrows the list too, so both views show
              it. It is where, not a filter: Clear all leaves it, and this chip
              is its one way back. */}
          {query.bbox ? (
            <button
              type="button"
              className="explore-chip explore-area-chip"
              aria-label={query.area ? `Remove map area, back to all of ${query.area.name}` : "Remove map area"}
              onClick={() => { update({ bbox: null }); advancedTrigger.current?.focus(); }}
            >
              <span>Map area</span>
              <Icon name="close" />
            </button>
          ) : null}
          {filterCount ? (
            <button
              type="button"
              className="explore-clear-all"
              onClick={() => { clearFilters(); advancedTrigger.current?.focus(); }}
            >Clear all</button>
          ) : null}
      </div>
    );
  }

  const notices = error ? <Notice tone="error" title={error} /> : null;

  return (
    <>
    {/* The title scrolls away with the page's header; only the console below it
        sticks (owner, 2026-09-29). It sits outside `.explore` so the line that
        tells the console it is pinned starts where the console does. */}
    {signedIn ? (
      <header className="explore-portal-masthead">
        <PageHeader
          // The top bar already names the page; the masthead says what it is for.
          title="Find your next place"
          description="Verified rentals, approved to list."
        />
      </header>
    ) : null}
    <div className={`explore${signedIn ? " explore-portal" : ""}`} ref={exploreRef}>
      {/* Where discovery would be if it scrolled away: once this line passes
          under the global header, the appropriate discovery surface is stuck. */}
      <div ref={stickLine} className="explore-stick-line" aria-hidden="true" />
      {signedIn ? (
        <section ref={stickRef} className={`explore-portal-intro${stuck ? " is-stuck" : ""}`}>
          {discovery()}
          {/* Pinned, the band keeps the page's name beside its controls. */}
          <p className="explore-stick-title" aria-hidden="true">Find your next place</p>
        </section>
      ) : (
        <div ref={stickRef} className={`explore-stick${stuck ? " is-stuck" : ""}`}>
          {discovery()}
          <p className="explore-stick-title" aria-hidden="true">Find your next place</p>
        </div>
      )}
      {resultsFeedback()}
      {notices}

      {/* The map takes the list's place in the page; it never covers the page. */}
      {mapView ? (
        <ExploreMapView
          query={query}
          search={search}
          area={query.area}
          listings={listings}
          next={next}
          loadingMore={loadingMore}
          querying={querying}
          savedIds={saved}
          onSave={signedIn ? (listing) => void toggleSave(listing) : undefined}
          onLoadMore={() => void loadMore()}
          onOpenListing={rememberExplorePosition}
          onSearchArea={(bounds: GeoBounds) => update({ bbox: bounds })}
          onClearFilters={clearFilters}
          hasFilters={filterCount > 0}
        />
      ) : (
        <section aria-live="polite" aria-busy={listings === null || querying}>
          {listings?.length ? (
            <ul className="explore-grid">
              {listings.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  saved={saved.has(listing.id)}
                  onSave={signedIn ? () => void toggleSave(listing) : undefined}
                  onNavigate={rememberExplorePosition}
                />
              ))}
            </ul>
          ) : null}

          {/* Guidance only. The one Clear all sits directly above, beside the
              count it would change; a second one here said the same thing twice. */}
          {listings?.length === 0 && !error ? (
            <div className="explore-empty">
              <p className="type-body-strong">Nothing matches yet</p>
              <p className="type-caption">Try a wider rent, a longer advance, or a nearby area.</p>
            </div>
          ) : null}

          {next ? (
            <p style={{ marginTop: "var(--space-6)" }}>
              <button
                type="button"
                className="explore-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >{loadingMore ? "Loading…" : "Show more rentals"}</button>
            </p>
          ) : null}
        </section>
      )}

      {/* A phone's one switch between the two views, floating where a thumb is.
          Wider screens switch from the discovery toolbar; CSS shows one or
          the other, and this steps aside for the Filters sheet. */}
      {advancedOpen ? null : (
        <button type="button" className="explore-view-switch" onClick={mapView ? showList : showMap}>
          <Icon name={mapView ? "listings" : "map"} />
          <span>{mapView ? "List" : "Map"}</span>
        </button>
      )}
    </div>
    </>
  );
}
