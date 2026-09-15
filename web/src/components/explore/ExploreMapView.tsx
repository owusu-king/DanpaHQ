"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/portal/icons";
import { ListingCard } from "@/components/listings/ListingCard";
import { isAborted } from "@/lib/api";
import type { Listing } from "@/lib/console";
import { formatBounds, roundCoordinate, type ExploreArea, type ExploreQuery } from "@/lib/exploreQuery";
import { mapSetupHint, mapsConfigured } from "@/lib/maps";
import {
  getListingsById,
  searchListingMap,
  type MapClusterFeature,
  type MapFeature,
  type MapListingFeature,
} from "@/lib/mapSearch";
import { getMapConfig, type GeoBounds, type MapConfig } from "@/lib/places";

import type { MapMove, MapSelection } from "./ExploreMap";
import { MapListingPreview } from "./MapListingPreview";

/**
 * Explore as a map: the same search, drawn where it is.
 *
 * It holds nothing that is the search. The area, the filters and the sort come
 * in as `query`; what the map adds is only what a map has — the window on
 * screen, the zoom, the marker somebody tapped. Switching back to the list
 * hands back the same query, so the place and the filters are exactly as they
 * were.
 *
 * It takes the list's place inside the page rather than covering the page, so
 * the site's header, the search and the filters stay where they were. Wide
 * screens put the results beside a map that stays in view under the header as
 * they scroll, so a card and its marker point at each other. Narrow screens
 * give the map the page's width with the list one switch away, and the preview
 * rises from the bottom where a thumb is.
 */

const ExploreMap = dynamic(() => import("./ExploreMap").then((module) => module.ExploreMap), {
  ssr: false,
  loading: () => <div className="explore-map-frame"><div className="explore-map-loading" aria-hidden="true" /></div>,
});

const VISITED_KEY = "rooomly:visited-listings";

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 63.999rem)");
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return narrow;
}

function readVisited(): Set<string> {
  try {
    return new Set(JSON.parse(window.sessionStorage.getItem(VISITED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

function area(bounds: GeoBounds) {
  return Math.max(0, bounds.east - bounds.west) * Math.max(0, bounds.north - bounds.south);
}

function contains(bounds: GeoBounds, lng: number, lat: number) {
  return lng >= bounds.west && lng <= bounds.east && lat >= bounds.south && lat <= bounds.north;
}

function grow(bounds: GeoBounds, by: number): GeoBounds {
  const dx = (bounds.east - bounds.west) * by;
  const dy = (bounds.north - bounds.south) * by;
  return { west: bounds.west - dx, south: bounds.south - dy, east: bounds.east + dx, north: bounds.north + dy };
}

/** Moved far enough that the results no longer describe what is on screen. */
function outgrewSearch(view: GeoBounds, searched: GeoBounds): boolean {
  const centerLng = (view.west + view.east) / 2;
  const centerLat = (view.south + view.north) / 2;
  if (!contains(grow(searched, 0.1), centerLng, centerLat)) return true;
  const ratio = area(view) / Math.max(area(searched), 1e-9);
  return ratio > 3 || ratio < 0.04;
}

type Summary = { total: number; unmapped: number; extent: GeoBounds | null };

export function ExploreMapView({
  query,
  search,
  area,
  listings,
  next,
  loadingMore,
  querying,
  savedIds,
  onSave,
  onLoadMore,
  onOpenListing,
  onSearchArea,
  onClearFilters,
  hasFilters,
}: {
  query: ExploreQuery;
  /** `listingSearchParams(query)`, as a string: the one question both views ask. */
  search: string;
  /** The chosen place, when there is one: its name and its box. */
  area: ExploreArea | null;
  listings: Listing[] | null;
  next: string | null;
  loadingMore: boolean;
  querying: boolean;
  savedIds: ReadonlySet<string>;
  onSave?: (listing: Listing) => void;
  onLoadMore: () => void;
  onOpenListing: (listing: Listing) => void;
  onSearchArea: (bounds: GeoBounds) => void;
  onClearFilters: () => void;
  hasFilters: boolean;
}) {
  const narrow = useNarrow();
  const [config, setConfig] = useState<MapConfig | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [markersFailed, setMarkersFailed] = useState(false);
  const [view, setView] = useState<MapMove | null>(null);
  const [userMoved, setUserMoved] = useState(false);
  const [selection, setSelection] = useState<(NonNullable<MapSelection> & { lat: number; lng: number }) | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [preview, setPreview] = useState<{ listings: Listing[]; loading: boolean; failed: boolean }>({ listings: [], loading: false, failed: false });
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  const [zoomTo, setZoomTo] = useState<{ key: string; bounds: GeoBounds; maxZoom?: number } | null>(null);
  const [suppressedFit, setSuppressedFit] = useState<string | null>(null);
  const markerRequest = useRef(0);
  const summaryRequest = useRef(0);
  const viewRef = useRef<MapMove | null>(null);

  // A build without a map key has no map to wait for: the list is the search.
  const mapAvailable = mapsConfigured();
  const setupHint = mapSetupHint();

  useEffect(() => {
    setVisited(readVisited());
    if (!mapAvailable) return;
    getMapConfig().then(setConfig).catch(() => setConfigFailed(true));
  }, [mapAvailable]);

  // A new search is a new set of rentals: whatever was selected may not be in it.
  useEffect(() => {
    setSelection(null);
    setUserMoved(false);
  }, [search]);

  const searched: GeoBounds | null = query.bbox ?? area?.bounds ?? summary?.extent ?? null;

  // Recomputed each render and cheap: the map refits only when the key changes.
  const areaTarget = query.bbox
    ? { key: `bbox:${formatBounds(query.bbox)}`, bounds: query.bbox, maxZoom: 17 }
    : area
      ? { key: `area:${area.ref || formatBounds(area.bounds)}`, bounds: area.bounds, maxZoom: 16 }
      : summary?.extent
        ? { key: "extent", bounds: summary.extent, maxZoom: 14 }
        : null;
  // "Search this area" searched what is already on screen; fitting it again
  // would nudge the map for no reason.
  const fit = zoomTo ?? (areaTarget && suppressedFit === areaTarget.key ? null : areaTarget);

  const fetchMarkers = useCallback((move: MapMove | null, withSummary: boolean) => {
    const id = ++markerRequest.current;
    const summaryId = withSummary ? ++summaryRequest.current : summaryRequest.current;
    const controller = new AbortController();
    setLoading(true);
    searchListingMap(
      new URLSearchParams(search),
      { window: move?.bounds ?? null, zoom: move?.zoom ?? 12, summary: withSummary },
      controller.signal,
    )
      .then((response) => {
        // A slower, older answer must never replace a newer one.
        if (id !== markerRequest.current) return;
        setFeatures(response.features);
        setTruncated(response.truncated);
        setMarkersFailed(false);
        setLoading(false);
        if (withSummary && summaryId === summaryRequest.current && typeof response.total === "number") {
          setSummary({ total: response.total, unmapped: response.unmapped ?? 0, extent: response.extent ?? null });
        }
      })
      .catch((cause) => {
        if (isAborted(cause) || id !== markerRequest.current) return;
        // The markers already drawn stay; the search is untouched.
        setMarkersFailed(true);
        setLoading(false);
      });
    return controller;
  }, [search]);

  // The search changed: new count, new extent, new markers for this window.
  useEffect(() => {
    const controller = fetchMarkers(viewRef.current, true);
    return () => controller.abort();
  }, [fetchMarkers]);

  // Only the window changed: redraw markers, and leave the count alone.
  useEffect(() => {
    if (!view) return;
    const timer = window.setTimeout(() => { controller = fetchMarkers(view, false); }, 220);
    let controller: AbortController | null = null;
    return () => {
      window.clearTimeout(timer);
      controller?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // What a selected marker shows: the loaded cards first, the API for the rest.
  useEffect(() => {
    if (!selection) {
      setPreview({ listings: [], loading: false, failed: false });
      return;
    }
    const known = new Map((listings ?? []).map((row) => [row.id, row]));
    const missing = selection.ids.filter((id) => !known.has(id));
    if (!missing.length) {
      setPreview({ listings: selection.ids.map((id) => known.get(id)!), loading: false, failed: false });
      return;
    }
    const controller = new AbortController();
    setPreview((current) => ({ ...current, loading: true, failed: false }));
    getListingsById(selection.ids, controller.signal)
      .then((rows) => setPreview({ listings: rows, loading: false, failed: false }))
      .catch((cause) => {
        if (isAborted(cause)) return;
        setPreview({ listings: [], loading: false, failed: true });
      });
    return () => controller.abort();
  }, [selection, listings, previewAttempt]);

  useEffect(() => {
    if (!selection) return;
    function close(event: KeyboardEvent) {
      if (event.key === "Escape") setSelection(null);
    }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [selection]);

  function selectListing(feature: MapListingFeature) {
    setPreviewIndex(0);
    setSelection({ key: `listing:${feature.id}`, ids: [feature.id], lat: feature.lat, lng: feature.lng });
  }

  function selectCluster(feature: MapClusterFeature) {
    if (feature.stacked && feature.ids?.length) {
      setPreviewIndex(0);
      setSelection({ key: `cluster:${feature.key}`, ids: feature.ids, lat: feature.lat, lng: feature.lng });
      return;
    }
    setSelection(null);
    setZoomTo({ key: `cluster:${feature.key}:${Date.now()}`, bounds: grow(feature.bounds, 0.35), maxZoom: 17 });
  }

  function openListing(listing: Listing) {
    const next = new Set(visited);
    next.add(listing.id);
    try {
      window.sessionStorage.setItem(VISITED_KEY, JSON.stringify([...next].slice(-200)));
    } catch {
      // Visited is a courtesy; losing it loses nothing else.
    }
    setVisited(next);
    onOpenListing(listing);
  }

  function searchThisArea() {
    if (!view) return;
    const bounds = {
      west: roundCoordinate(view.bounds.west),
      south: roundCoordinate(view.bounds.south),
      east: roundCoordinate(view.bounds.east),
      north: roundCoordinate(view.bounds.north),
    };
    setSuppressedFit(`bbox:${formatBounds(bounds)}`);
    setZoomTo(null);
    setUserMoved(false);
    onSearchArea(bounds);
  }

  const showSearchArea = Boolean(userMoved && view && searched && outgrewSearch(view.bounds, searched));
  const total = summary?.total ?? null;
  const areaName = query.bbox ? "in this map area" : area ? `in ${area.name.split(",")[0]}` : "across Ghana";
  const noneHere = total === 0 && !loading;
  const selectedListing = preview.listings[previewIndex] ?? null;

  const previewCard = selection ? (
    <MapListingPreview
      listings={preview.listings}
      index={Math.min(previewIndex, Math.max(preview.listings.length - 1, 0))}
      loading={preview.loading}
      failed={preview.failed}
      savedIds={savedIds}
      onSave={onSave}
      onStep={setPreviewIndex}
      onClose={() => setSelection(null)}
      onRetry={() => setPreviewAttempt((attempt) => attempt + 1)}
      onOpen={openListing}
      variant={narrow ? "sheet" : "popup"}
    />
  ) : null;

  return (
    <section className="explore-map-view" aria-label="Rentals on a map">
      <aside className="explore-map-results" aria-label="Results in this search" aria-busy={querying}>
        {summary?.unmapped ? (
          <p className="explore-map-note">
            {summary.unmapped === 1
              ? "1 rental here has no map position yet. It is in this list."
              : `${summary.unmapped} rentals here have no map position yet. They are in this list.`}
          </p>
        ) : null}

        {listings?.length ? (
          <ul className="explore-map-list">
            {listings.map((listing) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                saved={savedIds.has(listing.id)}
                onSave={onSave ? () => onSave(listing) : undefined}
                onNavigate={() => openListing(listing)}
                highlighted={selection?.ids.includes(listing.id) || hoveredId === listing.id}
                onHoverChange={(hovering) => setHoveredId(hovering ? listing.id : null)}
              />
            ))}
          </ul>
        ) : null}
        {next ? (
          <button type="button" className="explore-more" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading…" : "Show more rentals"}
          </button>
        ) : null}
        {listings?.length === 0 && !querying ? (
          <div className="explore-map-empty-list">
            <p className="type-body-strong">No available rentals {areaName}.</p>
            <p className="type-caption">Zoom out and search this area, clear a filter, or try a nearby place.</p>
          </div>
        ) : null}
      </aside>

      <div className="explore-map-stage">
        {!mapAvailable ? (
          <div className="explore-map-frame">
            <div className="explore-map-failed" role="status">
              <strong>The map is not available here yet.</strong>
              <span>Every rental in this search is still in the list.</span>
              {setupHint ? <span>{setupHint}</span> : null}
            </div>
          </div>
        ) : config ? (
          <ExploreMap
            config={config}
            features={features}
            fit={fit}
            padding={narrow ? { top: 64, right: 28, bottom: 96, left: 28 } : { top: 64, right: 64, bottom: 64, left: 64 }}
            selection={selection}
            hoveredId={hoveredId}
            visited={visited}
            preview={narrow ? null : previewCard}
            previewAt={!narrow && selection && (selectedListing || preview.loading || preview.failed) ? { lat: selection.lat, lng: selection.lng } : null}
            onMove={(move) => {
              viewRef.current = move;
              setView(move);
              if (move.byUser) {
                setUserMoved(true);
                setZoomTo(null);
              }
            }}
            onSelectListing={selectListing}
            onSelectCluster={selectCluster}
            onBackgroundClick={() => setSelection(null)}
            onFailure={() => setMapFailed(true)}
          />
        ) : (
          <div className="explore-map-frame">
            {configFailed ? (
              <div className="explore-map-failed" role="status">
                <strong>The map could not load right now.</strong>
                <span>Your search is unchanged, and the rentals are still listed.</span>
              </div>
            ) : <div className="explore-map-loading" aria-hidden="true" />}
          </div>
        )}

        <div className="explore-map-overlay-top">
          {loading ? <span className="explore-map-progress" aria-hidden="true" /> : null}
          {showSearchArea && !mapFailed ? (
            <button type="button" className="explore-search-area" onClick={searchThisArea}>
              <Icon name="explore" />
              <span>Search this area</span>
            </button>
          ) : null}
          {markersFailed ? (
            <button type="button" className="explore-map-retry" onClick={() => fetchMarkers(viewRef.current, true)}>
              Markers did not update. Retry
            </button>
          ) : truncated ? (
            <p className="explore-map-hint">Zoom in to see every marker in this area.</p>
          ) : null}
        </div>

        {noneHere && !mapFailed ? (
          <div className="explore-map-empty" role="status">
            <strong>No available rentals {areaName}.</strong>
            <span>The map stays here; widen the search to see more.</span>
            <div>
              {view ? (
                <button
                  type="button"
                  className="explore-text-button"
                  onClick={() => setZoomTo({ key: `out:${Date.now()}`, bounds: grow(view.bounds, 1.2), maxZoom: 13 })}
                >Zoom out</button>
              ) : null}
              {hasFilters ? <button type="button" className="explore-text-button" onClick={onClearFilters}>Clear filters</button> : null}
            </div>
          </div>
        ) : null}

        {narrow && previewCard ? <div className="explore-map-sheet">{previewCard}</div> : null}
      </div>
    </section>
  );
}
