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
import { DropdownMenu } from "radix-ui";

import { Notice } from "@/components/Notice";
import { ListingCard } from "@/components/listings/ListingCard";
import { ExploreMapView } from "@/components/explore/ExploreMapView";
import { PlaceSearch } from "@/components/explore/PlaceSearch";
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
import { getPlace, type GeoBounds, type Place } from "@/lib/places";
import { loadPropertyTypes, type PropertyTypeOption } from "@/lib/propertyTypes";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/toast/Toaster";
import { Switch } from "@/components/Check";
import { Field } from "@/components/Field";
import { Icon } from "@/components/portal/icons";

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
 * The search lives in the address bar (`exploreQuery`). The field, the pills,
 * the panel, the cards, the map and the count all read it and write it back, so
 * none of them keeps a copy to fall out of step, and opening the map, closing
 * it, leaving for a listing, refreshing or sharing the link all return the same
 * search. Choosing a place opens the map on it; the map is a view of the search,
 * never its owner.
 *
 * Every choice is shown once and removed one way. Place lives in the search
 * field, which owns the only clear for it; rent, property type, bedrooms and
 * furnishing are shown on their own pills; the chips below carry only what no
 * pill shows.
 */

/** `bedrooms_min=0` matched every listing — the backend filters `>=` — so a
 * "Single room / studio" choice was Any under another name. Rooms and studios
 * are Unit types, and are chosen there. */
const BEDROOMS = [
  ["", "Any bedrooms", "Any"],
  ["1", "1+ bedroom", "1+"],
  ["2", "2+ bedrooms", "2+"],
  ["3", "3+ bedrooms", "3+"],
] as const;

/** Advance is the question that decides whether a place is possible at all. */
const ADVANCE = [
  ["", "Any advance", "Any"],
  ["6", "6 months or less", "Up to 6 months"],
  ["12", "1 year or less", "Up to 1 year"],
  ["24", "2 years or less", "Up to 2 years"],
] as const;

const SORTS: ReadonlyArray<readonly [ListingSort, string]> = [
  ["newest", "Newest first"],
  ["rent_asc", "Rent: low to high"],
  ["rent_desc", "Rent: high to low"],
];

const RENT_PRESETS = [
  ["", "Any rent"],
  ["1000", "Up to GH₵1,000"],
  ["1500", "Up to GH₵1,500"],
  ["2500", "Up to GH₵2,500"],
  ["4000", "Up to GH₵4,000"],
  ["6000", "Up to GH₵6,000"],
] as const;

const cedis = (value: string) => Number(value).toLocaleString("en-GH");

/** Place is not a filter: clearing filters keeps it, and choosing one clears the others' area. */
const NO_LOCATION: Partial<ExploreQuery> = { place: "", q: "", bbox: null, localityId: "", localityName: "" };

export function ListingBrowser() {
  const { state } = useSession();
  const { toast } = useToast();
  const signedIn = state.status === "signed_in";

  const params = useSearchParams();
  const paramsKey = params.toString();
  const query = useMemo(() => parseExploreQuery(new URLSearchParams(paramsKey)), [paramsKey]);
  const search = useMemo(() => listingSearchParams(query).toString(), [query]);

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState("");
  const [place, setPlace] = useState<Place | null>(null);
  const [placeMissing, setPlaceMissing] = useState(false);
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[]>([]);
  const [rentMinDraft, setRentMinDraft] = useState(query.rentMin);
  const [rentMaxDraft, setRentMaxDraft] = useState(query.rentMax);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [saved, setSaved] = useState<Set<string>>(new Set());
  const requestId = useRef(0);
  const knownPlaces = useRef(new Map<string, Place>());
  const advancedPanel = useRef<HTMLDivElement>(null);
  const advancedTrigger = useRef<HTMLButtonElement>(null);
  const advancedClose = useRef<HTMLButtonElement>(null);
  const advancedShow = useRef<HTMLButtonElement>(null);

  /**
   * Write the search back to the address bar. Read from `window.location`, not
   * from the render's `query`, so two changes in one event compose instead of
   * the second undoing the first. Pushing makes Back undo it (opening the map);
   * replacing keeps adjustments from building a trail somebody has to walk back.
   */
  const update = useCallback((patch: Partial<ExploreQuery>, mode: "push" | "replace" = "replace") => {
    const current = parseExploreQuery(new URLSearchParams(window.location.search));
    const nextParams = serializeExploreQuery({ ...current, ...patch });
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
    if (listings === null || query.view === "map") return;
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
  }, [listings, query.view]);

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

  // The slug in the address bar becomes the place it names — its name, its box.
  useEffect(() => {
    if (!query.place) {
      setPlace(null);
      setPlaceMissing(false);
      return;
    }
    const known = knownPlaces.current.get(query.place);
    if (known) {
      setPlace(known);
      setPlaceMissing(false);
      return;
    }
    const controller = new AbortController();
    getPlace(query.place, controller.signal)
      .then((row) => {
        knownPlaces.current.set(row.slug, row);
        setPlace(row);
        setPlaceMissing(false);
      })
      .catch((cause) => {
        if (isAborted(cause)) return;
        if (cause instanceof ApiFailure && cause.status === 404) setPlaceMissing(true);
      });
    return () => controller.abort();
  }, [query.place]);

  useEffect(() => {
    void loadPropertyTypes().then(setPropertyTypes).catch(() => setPropertyTypes([]));
  }, []);

  // Rent is typed a digit at a time, so the fields keep the draft and the search
  // takes it once the typing settles.
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
      if (event.key !== "Escape") return;
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
    if (!advancedOpen || query.view === "map" || !window.matchMedia("(max-width: 63.999rem)").matches) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = previous; };
  }, [advancedOpen, query.view]);

  useEffect(() => {
    if (!signedIn) return;
    void listSavedListings()
      .then((rows) => setSaved(new Set(rows.map((row) => row.listing.id))))
      .catch(() => undefined);
  }, [signedIn]);

  const propertyLabel = propertyTypes.find((row) => row.value === query.propertyType)?.label ?? query.propertyType;
  const spaceLabel = spaceTypes.find((row) => row.value === query.spaceType)?.label ?? query.spaceType;
  const bedroomsLabel = BEDROOMS.find(([value]) => value === query.bedrooms)?.[1] ?? query.bedrooms;
  const rentLabel = query.rentMin && query.rentMax
    ? `GH₵${cedis(query.rentMin)}–${cedis(query.rentMax)}`
    : query.rentMax
      ? `Up to GH₵${cedis(query.rentMax)}`
      : query.rentMin
        ? `From GH₵${cedis(query.rentMin)}`
        : null;
  const rentOptions = query.rentMax && !RENT_PRESETS.some(([value]) => value === query.rentMax)
    ? [...RENT_PRESETS, [query.rentMax, `Up to GH₵${cedis(query.rentMax)}`] as const]
    : RENT_PRESETS;
  const filterCount = refinementCount(query);

  // Chips for the refinements no pill shows, and only those.
  const unshown = [
    query.spaceType && { key: "space_type", label: spaceLabel, clear: () => update({ spaceType: "" }) },
    query.advanceMax && {
      key: "advance_max",
      label: `Advance ${ADVANCE.find(([value]) => value === query.advanceMax)?.[2].toLowerCase() ?? query.advanceMax}`,
      clear: () => update({ advanceMax: "" }),
    },
    query.sort !== "newest" && {
      key: "sort",
      label: SORTS.find(([value]) => value === query.sort)?.[1] ?? query.sort,
      clear: () => update({ sort: "newest" }),
    },
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  const resultCount = listings === null ? "" : `${listings.length}${next ? "+" : ""}`;
  const resultWord = listings?.length === 1 && !next ? "rental" : "rentals";
  const showLabel = listings === null || querying ? "Updating rentals…" : `Show ${resultCount} ${resultWord}`;

  function changePropertyType(value: string) {
    const allowed = propertyTypes.find((type) => type.value === value)?.space_types ?? [];
    const keepSpace = !value || !query.spaceType || allowed.some((space) => space.value === query.spaceType);
    update({ propertyType: value, spaceType: keepSpace ? query.spaceType : "" });
  }

  /** The Rent pill is the whole range: Any clears both ends, and a maximum
   * below the chosen minimum would be a range nothing can match. */
  function chooseRent(value: string) {
    if (!value) { update({ rentMin: "", rentMax: "" }); return; }
    update({ rentMax: value, rentMin: query.rentMin && Number(query.rentMin) > Number(value) ? "" : query.rentMin });
  }

  // Filters, not place: the search field owns the one clear for that.
  function clearFilters() {
    update(withoutFilters(query));
  }

  function choosePlace(row: Place) {
    knownPlaces.current.set(row.slug, row);
    setPlace(row);
    setPlaceMissing(false);
    // Choosing a place opens the map on it. Pushed, so Back returns to the list.
    update({ ...NO_LOCATION, place: row.slug, view: "map" }, query.view === "map" ? "replace" : "push");
  }

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

  function discovery(variant: "page" | "map"): ReactNode {
    return (
      <div className="explore-discovery" data-variant={variant}>
        <div className="explore-bar">
          <PlaceSearch
            label="Search by location or property"
            variant={variant === "map" ? "map" : "tray"}
            place={place}
            text={query.place ? "" : query.localityName || query.q}
            onChoosePlace={choosePlace}
            onSubmitText={(text) => update({ ...NO_LOCATION, q: text })}
            onClear={() => update(NO_LOCATION)}
          />
        </div>

        {/* Filters leads the rail. At the end it was scrolled out of sight on a
            phone, taking the count of hidden choices with it. */}
        <div className="explore-quick" role="group" aria-label="Quick rental filters">
          <button
            ref={advancedTrigger}
            type="button"
            className={`explore-filter-pill explore-more-filters${advancedOpen ? " is-open" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={advancedOpen}
            aria-controls="explore-advanced-filters"
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <Icon name="filters" />
            <span>Filters</span>
            {filterCount ? (
              <span className="explore-filter-count">
                <span aria-hidden="true">{filterCount}</span>
                <span className="sr-only">, {filterCount} active</span>
              </span>
            ) : null}
          </button>
          <span className="explore-quick-divider" aria-hidden="true" />
          <QuickSelectFilter
            label="Rent"
            heading="Maximum monthly rent"
            display={rentLabel}
            value={query.rentMax || (query.rentMin ? "from" : "")}
            onChange={chooseRent}
            options={rentOptions}
          />
          <QuickSelectFilter
            label="Property type"
            heading="Property type"
            display={query.propertyType ? propertyLabel : null}
            value={query.propertyType}
            onChange={changePropertyType}
            options={[
              ["", "Any property type"] as const,
              ...propertyTypes.map((type) => [type.value, type.label] as const),
            ]}
          />
          <QuickSelectFilter
            label="Bedrooms"
            heading="Bedrooms"
            display={query.bedrooms ? bedroomsLabel : null}
            value={query.bedrooms}
            onChange={(value) => update({ bedrooms: value })}
            options={BEDROOMS.map(([value, label]) => [value, label] as const)}
          />
          <button
            type="button"
            className={`explore-filter-pill is-toggle${query.furnished ? " is-active" : ""}`}
            aria-pressed={query.furnished}
            onClick={() => update({ furnished: !query.furnished })}
          >Furnished</button>
          {variant === "page" ? (
            <button
              type="button"
              className="explore-filter-pill explore-map-toggle"
              onClick={() => update({ view: "map" }, "push")}
            >
              <Icon name="map" />
              <span>Map</span>
            </button>
          ) : null}
        </div>

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
                <section className="explore-filter-group" aria-labelledby="filter-price-heading">
                  <h3 id="filter-price-heading">Price</h3>
                  <FilterRow label="Monthly rent" fields>
                    <div className="explore-price-fields">
                      <Field label="Minimum rent" prefix="GH₵" inputMode="numeric" value={rentMinDraft} onChange={(event) => setRentMinDraft(event.target.value.replace(/\D/g, ""))} placeholder="No minimum" />
                      <Field label="Maximum rent" prefix="GH₵" inputMode="numeric" value={rentMaxDraft} onChange={(event) => setRentMaxDraft(event.target.value.replace(/\D/g, ""))} placeholder="No maximum" />
                    </div>
                  </FilterRow>
                </section>

                <section className="explore-filter-group" aria-labelledby="filter-space-heading">
                  <h3 id="filter-space-heading">Property &amp; unit</h3>
                  <ChoiceSet
                    name="explore-property-type"
                    label="Property type"
                    value={query.propertyType}
                    onChange={changePropertyType}
                    options={[["", "Any"] as const, ...propertyTypes.map((type) => [type.value, type.label] as const)]}
                  />
                  <ChoiceSet
                    name="explore-space-type"
                    label="Unit type"
                    value={query.spaceType}
                    onChange={(value) => update({ spaceType: value })}
                    options={[["", "Any"] as const, ...spaceTypes.map((space) => [space.value, space.label] as const)]}
                  />
                  <ChoiceSet
                    name="explore-bedrooms"
                    label="Bedrooms"
                    value={query.bedrooms}
                    onChange={(value) => update({ bedrooms: value })}
                    options={BEDROOMS.map(([value, , short]) => [value, short] as const)}
                  />
                </section>

                <section className="explore-filter-group" aria-labelledby="filter-terms-heading">
                  <h3 id="filter-terms-heading">Rental terms</h3>
                  <ChoiceSet
                    name="explore-advance"
                    label="Maximum advance"
                    value={query.advanceMax}
                    onChange={(value) => update({ advanceMax: value })}
                    options={ADVANCE.map(([value, , short]) => [value, short] as const)}
                  />
                  {/* On or off, so a switch: a tick reads as one answer of several. */}
                  <label className="explore-filter-row explore-switch-row">
                    <span className="explore-filter-label">Furnished only</span>
                    <span className="explore-switch">
                      <Switch checked={query.furnished} onChange={(checked) => update({ furnished: checked })} label="Furnished only" />
                    </span>
                  </label>
                </section>

                <section className="explore-filter-group" aria-labelledby="filter-order-heading">
                  <h3 id="filter-order-heading">Order results</h3>
                  <ChoiceSet
                    name="explore-sort"
                    label="Sort by"
                    value={query.sort}
                    onChange={(value) => update({ sort: value as ListingSort })}
                    options={SORTS}
                  />
                </section>
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

        {variant === "page" || query.bbox || unshown.length || filterCount ? (
          <div className="explore-feedback">
            {variant === "page" ? (
              <p className="explore-count" aria-live="polite">
                {listings === null || querying ? (
                  <>
                    <span className="explore-count-spinner" aria-hidden="true" />
                    {listings === null ? "Finding rentals…" : "Updating results…"}
                  </>
                ) : (
                  <span><strong>{resultCount}</strong> {resultWord}</span>
                )}
              </p>
            ) : null}
            {/* An area drawn on the map narrows the list too, so both views show
                it. It is where, not a filter: Clear all leaves it, and this chip
                is its one way back. */}
            {query.bbox ? (
              <button
                type="button"
                className="explore-chip explore-area-chip"
                aria-label={place ? `Remove map area, back to all of ${place.name}` : "Remove map area"}
                onClick={() => { update({ bbox: null }); advancedTrigger.current?.focus(); }}
              >
                <span>Map area</span>
                <Icon name="close" />
              </button>
            ) : null}
            {unshown.length ? (
              <ul className="explore-active" aria-label="Other active filters">
                {unshown.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      className="explore-chip"
                      aria-label={`Remove filter: ${item.label}`}
                      onClick={() => { item.clear(); advancedTrigger.current?.focus(); }}
                    >
                      <span>{item.label}</span>
                      <Icon name="close" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {filterCount ? (
              <button
                type="button"
                className="explore-clear-all"
                onClick={() => { clearFilters(); advancedTrigger.current?.focus(); }}
              >Clear all</button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const notices = (
    <>
      {placeMissing ? (
        <Notice tone="warning" title="That area is no longer offered. Your filters are unchanged." />
      ) : null}
      {error && !placeMissing ? <Notice tone="error" title={error} /> : null}
    </>
  );

  if (query.view === "map") {
    return (
      <ExploreMapView
        query={query}
        search={search}
        place={place}
        controls={<>{discovery("map")}{notices}</>}
        listings={listings}
        next={next}
        loadingMore={loadingMore}
        querying={querying}
        savedIds={saved}
        onSave={signedIn ? (listing) => void toggleSave(listing) : undefined}
        onLoadMore={() => void loadMore()}
        onOpenListing={() => undefined}
        onSearchArea={(bounds: GeoBounds) => update({ bbox: bounds })}
        onClearFilters={clearFilters}
        onClose={() => update({ view: "list" })}
        hasFilters={filterCount > 0}
      />
    );
  }

  return (
    <div className="explore">
      {discovery("page")}
      {notices}

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

      {/* A phone scrolls the rail's Map pill out of sight, so the switch floats
          where a thumb is; CSS shows one or the other. Not over the sheet. */}
      {advancedOpen ? null : (
        <button
          type="button"
          className="explore-view-switch explore-map-float"
          onClick={() => update({ view: "map" }, "push")}
        >
          <Icon name="map" />
          <span>Map</span>
        </button>
      )}
    </div>
  );
}

/**
 * A quick filter: a pill that opens a designed menu of answers.
 *
 * It was a native `<select>` stretched invisibly over the pill, so opening it
 * showed the operating system's own list — its grey, its highlight, its
 * position — under an arrow drawn from two CSS borders. The menu is Radix's:
 * arrow keys, typeahead, Escape and focus return all come with it, and it
 * portals out of the rail, which scrolls and would otherwise clip it.
 */
function QuickSelectFilter({
  label,
  heading,
  display,
  value,
  onChange,
  options,
}: {
  label: string;
  heading: string;
  /** The chosen answer as the pill should say it, or null while idle. */
  display: string | null;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  const [open, setOpen] = useState(false);
  const pointer = useRef("");
  const openAtPress = useRef(false);
  const active = display !== null;

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger
        className={`explore-filter-pill${active ? " is-active" : ""}`}
        aria-label={active ? `${label}: ${display}` : label}
        onPointerDown={(event) => {
          pointer.current = event.pointerType;
          openAtPress.current = open;
          // Radix opens on pointerdown for every pointer. On a rail that
          // scrolls sideways that turned the start of a swipe into an open
          // menu, so touch and pen wait for the tap to complete instead.
          if (event.pointerType !== "mouse") event.preventDefault();
        }}
        onClick={() => {
          // Decided from the state at the press, not now: Radix's outside
          // dismissal can close the menu first, and a toggle then reopened it.
          if (pointer.current === "touch" || pointer.current === "pen") setOpen(!openAtPress.current);
          pointer.current = "";
        }}
      >
        <span className="explore-pill-label">{display ?? label}</span>
        <span className="explore-pill-chevron" aria-hidden="true"><Icon name="chevron-down" /></span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="explore-menu" align="start" sideOffset={8} collisionPadding={12}>
          <DropdownMenu.Label className="explore-menu-heading">{heading}</DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
            {options.map(([key, text]) => (
              <DropdownMenu.RadioItem key={key || "any"} value={key} className="explore-menu-item">
                <span>{text}</span>
                <DropdownMenu.ItemIndicator className="explore-menu-check">
                  <Icon name="check" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A label column and a control column, so every row in the panel starts its
 * answers on the same line. */
function FilterRow({ label, fields = false, children }: { label: string; fields?: boolean; children: ReactNode }) {
  return (
    <div className={`explore-filter-row${fields ? " is-fields" : ""}`}>
      <span className="explore-filter-label">{label}</span>
      <div className="explore-filter-control">{children}</div>
    </div>
  );
}

/**
 * One answer from a short set, drawn as chips.
 *
 * These were `Select`s: a label, a closed box and the operating system's list
 * behind it, so seeing the options took a click and comparing them took two.
 * The radios stay real — one name, arrow keys between them — and are only
 * unpainted, the way `forms.css` draws every other choice in the product.
 */
function ChoiceSet({
  name,
  label,
  value,
  onChange,
  options,
}: {
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  const labelId = `${name}-label`;
  return (
    <div className="explore-filter-row">
      <span id={labelId} className="explore-filter-label">{label}</span>
      <div className="chip-set explore-choice-set" role="radiogroup" aria-labelledby={labelId}>
        {options.map(([key, text]) => (
          <label key={key || "any"} className="chip explore-choice">
            <input
              type="radio"
              name={name}
              value={key}
              checked={value === key}
              onChange={() => onChange(key)}
              className="control-input"
            />
            {text}
          </label>
        ))}
      </div>
    </div>
  );
}
