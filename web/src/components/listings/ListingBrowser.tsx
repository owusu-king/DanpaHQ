"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Notice } from "@/components/Notice";
import { ListingCard } from "@/components/listings/ListingCard";
import { ApiFailure } from "@/lib/api";
import { searchLocalities, type Listing, type Locality } from "@/lib/console";
import { listSavedListings } from "@/lib/tenant";
import {
  savePublicListing,
  searchPublicListings,
  searchPublicListingsPage,
  unsavePublicListing,
  type ListingFilters,
  type ListingSort,
} from "@/lib/listings";
import { loadPropertyTypes, type PropertyTypeOption } from "@/lib/propertyTypes";
import { useSession } from "@/lib/session";
import { useToast } from "@/components/toast/Toaster";
import { Check } from "@/components/Check";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";

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
 */

const BEDROOMS = [
  ["", "Any bedrooms"],
  ["0", "Single room / studio"],
  ["1", "1+ bedroom"],
  ["2", "2+ bedrooms"],
  ["3", "3+ bedrooms"],
] as const;

/** Advance is the question that decides whether a place is possible at all. */
const ADVANCE = [
  ["", "Any advance"],
  ["6", "6 months or less"],
  ["12", "1 year or less"],
  ["24", "2 years or less"],
] as const;

const SORTS: ReadonlyArray<readonly [ListingSort, string]> = [
  ["newest", "Newest first"],
  ["rent_asc", "Rent: low to high"],
  ["rent_desc", "Rent: high to low"],
];

export function ListingBrowser() {
  const { state } = useSession();
  const { toast } = useToast();
  const signedIn = state.status === "signed_in";

  const [listings, setListings] = useState<Listing[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [locality, setLocality] = useState<Locality | null>(null);
  const [suggestions, setSuggestions] = useState<Locality[]>([]);
  const [sort, setSort] = useState<ListingSort>("newest");
  const [propertyTypes, setPropertyTypes] = useState<PropertyTypeOption[]>([]);
  const [propertyType, setPropertyType] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [rentMax, setRentMax] = useState("");
  const [advanceMax, setAdvanceMax] = useState("");
  const [furnished, setFurnished] = useState(false);
  const [filtersReady, setFiltersReady] = useState(false);
  const [mobilePriceOpen, setMobilePriceOpen] = useState(false);

  const [saved, setSaved] = useState<Set<string>>(new Set());
  const requestId = useRef(0);

  const filters = useMemo<ListingFilters>(() => ({
    q: locality ? undefined : q.trim() || undefined,
    locality_id: locality?.id,
    property_type: propertyType || undefined,
    bedrooms_min: bedrooms === "" ? undefined : Number(bedrooms),
    rent_max: rentMax ? Math.round(Number(rentMax) * 100) : undefined,
    advance_max: advanceMax ? Number(advanceMax) : undefined,
    furnished: furnished || undefined,
    sort,
  }), [q, locality, propertyType, bedrooms, rentMax, advanceMax, furnished, sort]);

  // The URL is updated only as the tenant leaves. Back then reconstructs the
  // exact comparison set without turning every keystroke into navigation.
  function rememberExplorePosition() {
    const query = new URLSearchParams();
    if (locality) {
      query.set("locality_id", locality.id);
      query.set("locality_name", locality.name);
      query.set("district_name", locality.district_name);
    } else if (q.trim()) query.set("q", q.trim());
    if (propertyType) query.set("property_type", propertyType);
    if (bedrooms) query.set("bedrooms_min", bedrooms);
    if (rentMax) query.set("rent_max", rentMax);
    if (advanceMax) query.set("advance_max", advanceMax);
    if (furnished) query.set("furnished", "true");
    if (sort !== "newest") query.set("sort", sort);

    sessionStorage.setItem("rentals:return-scroll", String(window.scrollY));
    const returnUrl = `/rentals${query.size ? `?${query.toString()}` : ""}`;
    window.history.replaceState(
      { ...window.history.state, rentalsReturn: true },
      "",
      returnUrl,
    );
  }

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const localityId = query.get("locality_id");
    const localityName = query.get("locality_name");
    setQ(query.get("q") ?? "");
    setPropertyType(query.get("property_type") ?? "");
    setBedrooms(query.get("bedrooms_min") ?? "");
    setRentMax(query.get("rent_max") ?? "");
    setAdvanceMax(query.get("advance_max") ?? "");
    setFurnished(query.get("furnished") === "true");
    const initialSort = query.get("sort");
    setSort(initialSort === "rent_asc" || initialSort === "rent_desc" ? initialSort : "newest");
    if (localityId && localityName) {
      setLocality({
        id: localityId,
        name: localityName,
        aliases: [],
        district: "",
        district_name: query.get("district_name") ?? "",
        region_name: "",
      });
    }
    setFiltersReady(true);
  }, []);

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

  // Results follow the controls. Nothing here waits for a Search button — the
  // old form made every adjustment a round trip through a submit.
  useEffect(() => {
    if (!filtersReady) return;
    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      try {
        const page = await searchPublicListings(filters);
        // A slower earlier request must never overwrite a newer answer.
        if (id !== requestId.current) return;
        setListings(page.results);
        setNext(page.next);
        setError("");
      } catch (cause) {
        if (id !== requestId.current) return;
        setListings([]);
        setNext(null);
        setError(cause instanceof ApiFailure ? cause.error.message : "We could not load rentals.");
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [filters, filtersReady]);

  useEffect(() => {
    void loadPropertyTypes().then(setPropertyTypes).catch(() => setPropertyTypes([]));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    void listSavedListings()
      .then((rows) => setSaved(new Set(rows.map((row) => row.listing.id))))
      .catch(() => undefined);
  }, [signedIn]);

  // Ghana rentals are found by place first, so the search box offers real
  // localities rather than hoping a free-text match lands.
  useEffect(() => {
    if (locality || q.trim().length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(() => {
      void searchLocalities(q.trim()).then(setSuggestions).catch(() => setSuggestions([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, locality]);

  const active = [
    locality && { label: locality.name, clear: () => { setLocality(null); setQ(""); } },
    propertyType && { label: propertyTypes.find((row) => row.value === propertyType)?.label ?? propertyType, clear: () => setPropertyType("") },
    bedrooms !== "" && { label: BEDROOMS.find(([value]) => value === bedrooms)?.[1] ?? "", clear: () => setBedrooms("") },
    rentMax && { label: `Up to GH₵${rentMax}`, clear: () => setRentMax("") },
    advanceMax && { label: ADVANCE.find(([value]) => value === advanceMax)?.[1] ?? "", clear: () => setAdvanceMax("") },
    furnished && { label: "Furnished", clear: () => setFurnished(false) },
  ].filter(Boolean) as Array<{ label: string; clear: () => void }>;

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

  return (
    <div className="explore">
      <div className="explore-bar">
        <div className="explore-search">
          <label>
            <span className="sr-only">Search by place</span>
            <input
              type="search"
              value={locality ? locality.name : q}
              onChange={(event) => { setLocality(null); setQ(event.target.value); }}
              placeholder="Where? East Legon, Adenta, Asokwa…"
            />
          </label>
          {suggestions.length ? (
            <ul className="explore-suggestions">
              {suggestions.slice(0, 6).map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => { setLocality(row); setSuggestions([]); }}
                  >
                    {row.name} <span>{row.district_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="explore-bar-actions">
          <label>
            <span className="sr-only">Sort</span>
            <select className="explore-control" value={sort} onChange={(event) => setSort(event.target.value as ListingSort)}>
              {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* On a phone the controls stay discoverable without opening a wall of
          fields. List choices use the platform picker; the one free-form value
          opens a small inline editor rather than a modal or a full filter page. */}
      <div className="explore-mobile-filters">
        <div className="explore-filter-rail" role="group" aria-label="Rental filters">
          <MobileSelectFilter
            label="Bedrooms"
            value={bedrooms}
            onChange={setBedrooms}
            options={BEDROOMS}
          />
          <button
            type="button"
            className={`explore-filter-pill${rentMax ? " is-active" : ""}`}
            aria-expanded={mobilePriceOpen}
            aria-controls="explore-mobile-price"
            onClick={() => setMobilePriceOpen((open) => !open)}
          >
            {rentMax ? `Up to GH₵${Number(rentMax).toLocaleString("en-GH")}` : "Price"}
            <span className="explore-pill-chevron" aria-hidden="true">⌄</span>
          </button>
          <MobileSelectFilter
            label="Advance"
            value={advanceMax}
            onChange={setAdvanceMax}
            options={ADVANCE}
          />
          <MobileSelectFilter
            label="Type"
            value={propertyType}
            onChange={setPropertyType}
            options={[
              ["", "Any property type"] as const,
              ...propertyTypes.map((type) => [type.value, type.label] as const),
            ]}
          />
          <button
            type="button"
            className={`explore-filter-pill${furnished ? " is-active" : ""}`}
            aria-pressed={furnished}
            onClick={() => setFurnished((value) => !value)}
          >Furnished</button>
          <MobileSelectFilter
            label="Sort"
            value={sort === "newest" ? "" : sort}
            onChange={(value) => setSort((value || "newest") as ListingSort)}
            options={[["", "Newest first"] as const, ...SORTS.slice(1)]}
          />
          {active.length ? (
            <button
              type="button"
              className="explore-filter-reset"
              onClick={() => {
                setPropertyType(""); setBedrooms(""); setRentMax("");
                setAdvanceMax(""); setFurnished(false); setSort("newest");
                setMobilePriceOpen(false);
              }}
            >Reset</button>
          ) : null}
        </div>

        {mobilePriceOpen ? (
          <div className="explore-mobile-price" id="explore-mobile-price">
            <Field
              label="Maximum monthly rent"
              prefix="GH₵"
              inputMode="numeric"
              value={rentMax}
              onChange={(event) => setRentMax(event.target.value.replace(/\D/g, ""))}
              placeholder="3000"
            />
            <button type="button" className="explore-price-done" onClick={() => setMobilePriceOpen(false)}>
              Done
            </button>
          </div>
        ) : null}
      </div>

      <div
        id="explore-filters"
        className="explore-drawer"
        aria-label="Rental filters"
      >
        <Select
          label="Property type"
          value={propertyType}
          onChange={setPropertyType}
          options={[
            ["", "Any property type"] as const,
            ...propertyTypes.map((type) => [type.value, type.label] as const),
          ]}
        />
        <Select label="Bedrooms" value={bedrooms} onChange={setBedrooms} options={BEDROOMS} />
        <Field
          label="Maximum rent (GH₵)"
          inputMode="numeric"
          value={rentMax}
          onChange={(event) => setRentMax(event.target.value.replace(/\D/g, ""))}
          placeholder="3000"
        />
        <Select label="Advance" value={advanceMax} onChange={setAdvanceMax} options={ADVANCE} />
        <Check
          label="Furnished only"
          checked={furnished}
          onChange={setFurnished}
        />
      </div>

      {active.length ? (
        <div className="explore-active">
          {active.map((item) => (
            <button key={item.label} type="button" className="explore-chip" onClick={item.clear}>
              {item.label} <span aria-hidden="true">×</span>
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
          <button
            type="button"
            className="explore-chip"
            onClick={() => {
              setLocality(null); setQ(""); setPropertyType(""); setBedrooms("");
              setRentMax(""); setAdvanceMax(""); setFurnished(false);
            }}
          >Clear all</button>
        </div>
      ) : null}

      {error ? <Notice tone="error" title={error} /> : null}

      <section aria-live="polite" aria-busy={listings === null}>
        <p className="explore-count">
          {listings === null
            ? "Finding rentals…"
            : `${listings.length}${next ? "+" : ""} rental${listings.length === 1 ? "" : "s"}`}
        </p>

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

        {listings?.length === 0 && !error ? (
          <div className="explore-empty">
            <p className="type-body-strong">Nothing matches yet</p>
            <p className="type-caption">Try a wider rent, a longer advance, or a nearby area.</p>
            {active.length ? (
              <button
                type="button"
                className="explore-chip"
                onClick={() => {
                  setLocality(null); setQ(""); setPropertyType(""); setBedrooms("");
                  setRentMax(""); setAdvanceMax(""); setFurnished(false);
                }}
              >Clear all filters</button>
            ) : null}
          </div>
        ) : null}

        {next ? (
          <p style={{ marginTop: "var(--space-6)" }}>
            <button
              type="button"
              className="explore-more"
              disabled={loadingMore}
              onClick={async () => {
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
              }}
            >{loadingMore ? "Loading…" : "Show more rentals"}</button>
          </p>
        ) : null}
      </section>
    </div>
  );
}

function MobileSelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  const selected = options.find(([key]) => key === value)?.[1] ?? label;
  return (
    <label className={`explore-filter-pill explore-mobile-select${value ? " is-active" : ""}`}>
      <span>{value ? selected : label}</span>
      <span className="explore-pill-chevron" aria-hidden="true">⌄</span>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
      </select>
    </label>
  );
}
